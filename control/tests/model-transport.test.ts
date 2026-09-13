import test from "node:test";
import assert from "node:assert/strict";
import {
  forwardModelResponse,
  ModelRequestError,
  requestModelWithRetry,
} from "../agent/model-transport";

function stream(events: unknown[], separator = "\n") {
  const bytes = Buffer.from(
    events
      .map((event) => `data: ${JSON.stringify(event)}${separator}${separator}`)
      .join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7)
          controller.enqueue(bytes.subarray(offset, offset + 7));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

test("HTTP 200 streamed credit exhaustion preserves its cause instead of becoming sdk_transport", async () => {
  const messages: any[] = [];
  await assert.rejects(
    forwardModelResponse(
      stream([
        { type: "response.created", response: { status: "in_progress" } },
        {
          type: "response.failed",
          response: {
            error: {
              code: "credit_balance_exhausted",
              message: "private provider text",
            },
          },
        },
      ]),
      "request",
      (m) => messages.push(m),
    ),
    (error: any) => {
      assert.ok(error instanceof ModelRequestError);
      assert.equal(error.httpStatus, 200);
      assert.equal(error.code, "credit_balance_exhausted");
      assert.match(error.message, /Add credits/);
      assert.ok(!error.message.includes("private provider text"));
      return true;
    },
  );
  assert.ok(!messages.some((m) => m.type === "model-response-end"));
});

test("HTTP rejection and standalone SSE errors are safe and actionable", async () => {
  for (const response of [
    new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), {
      status: 429,
    }),
    stream([{ type: "error", code: "insufficient_quota" }]),
  ]) {
    await assert.rejects(
      forwardModelResponse(response, "request", () => {}),
      (e: any) => e.code === "insufficient_quota",
    );
  }
  await assert.rejects(
    forwardModelResponse(
      stream([
        {
          type: "response.failed",
          response: {
            error: {
              code: "unknown-sensitive-code",
              message: "You have no credits remaining. private",
            },
          },
        },
      ]),
      "request",
      () => {},
    ),
    (e: any) =>
      e.code === "credit_balance_exhausted" && !e.message.includes("private"),
  );
});

test("successful streams preserve exact bytes across UTF-8 and CRLF chunk boundaries", async () => {
  const response = stream(
    [
      { type: "response.output_text.delta", delta: "café 🎉" },
      { type: "response.completed", response: { status: "completed" } },
    ],
    "\r\n",
  );
  const original = await response.clone().text();
  const messages: any[] = [];
  await forwardModelResponse(response, "request", (m) => messages.push(m));
  assert.equal(
    Buffer.concat(
      messages
        .filter((m) => m.type === "model-response-chunk")
        .map((m) => Buffer.from(m.body, "base64")),
    ).toString(),
    original,
  );
  assert.equal(messages.at(-1).type, "model-response-end");
});

test("truncated and incomplete streams cannot be reported as complete", async () => {
  for (const [events, code] of [
    [[{ type: "response.created" }], "stream_incomplete"],
    [[{ type: "response.incomplete" }], "response_incomplete"],
  ] as const) {
    await assert.rejects(
      forwardModelResponse(stream([...events]), "request", () => {}),
      (e: any) => e.code === code,
    );
  }
});

test("streamed rate limit retries only the request and exposes no partial failed stream", async () => {
  let calls = 0;
  const delivered: any[] = [],
    waits: number[] = [];
  await requestModelWithRetry(
    async () => {
      calls++;
      return calls === 1
        ? stream([
            {
              type: "response.output_text.delta",
              delta: "DISCARDED PARTIAL ACTION",
            },
            {
              type: "response.failed",
              response: { error: { code: "rate_limit_exceeded" } },
            },
          ])
        : stream([
            { type: "response.completed", response: { status: "completed" } },
          ]);
    },
    "same-request",
    (m) => delivered.push(m),
    new AbortController().signal,
    () => {},
    async (ms) => {
      waits.push(ms);
    },
    () => 0,
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [10000]);
  assert.equal(
    delivered.filter((m) => m.type === "model-response-start").length,
    1,
  );
  assert.ok(
    !Buffer.concat(
      delivered.filter((m) => m.body).map((m) => Buffer.from(m.body, "base64")),
    )
      .toString()
      .includes("DISCARDED"),
  );
});

test("retry-after is honored, attempts are bounded and exhausted quota is never retried", async () => {
  const waits: number[] = [];
  let calls = 0;
  await assert.rejects(
    requestModelWithRetry(
      async () => {
        calls++;
        return Response.json(
          { error: { code: "rate_limit_exceeded" } },
          { status: 429, headers: { "retry-after": "30" } },
        );
      },
      "id",
      () => assert.fail("No failed response may be delivered"),
      new AbortController().signal,
      () => {},
      async (ms) => {
        waits.push(ms);
      },
      () => 0,
    ),
    (e: any) => e.code === "rate_limit_exceeded",
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [30000, 30000]);
  calls = 0;
  await assert.rejects(
    requestModelWithRetry(
      async () => {
        calls++;
        return Response.json(
          { error: { code: "insufficient_quota" } },
          { status: 429 },
        );
      },
      "id",
      () => {},
      new AbortController().signal,
      () => assert.fail("Quota is not retriable"),
    ),
    (e: any) => e.code === "insufficient_quota",
  );
  assert.equal(calls, 1);
});

test("cancellation interrupts retry waiting and no further requests run", async () => {
  const abort = new AbortController();
  let calls = 0;
  await assert.rejects(
    requestModelWithRetry(
      async () => {
        calls++;
        return Response.json(
          { error: { code: "rate_limit_exceeded" } },
          { status: 429 },
        );
      },
      "id",
      () => {},
      abort.signal,
      () => abort.abort(),
    ),
  );
  assert.equal(calls, 1);
});
