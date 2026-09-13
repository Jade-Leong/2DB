import test from "node:test";
import assert from "node:assert/strict";
import { forwardModelResponse, ModelRequestError } from "../agent/model-transport";

function stream(events: unknown[], separator = "\n") {
  const bytes = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}${separator}${separator}`).join(""));
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.subarray(offset, offset + 7));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

test("HTTP 200 streamed credit exhaustion preserves its cause instead of becoming sdk_transport", async () => {
  const messages: any[] = [];
  await assert.rejects(forwardModelResponse(stream([
    { type: "response.created", response: { status: "in_progress" } },
    { type: "response.failed", response: { error: { code: "credit_balance_exhausted", message: "private provider text" } } },
  ]), "request", m => messages.push(m)), (error: any) => {
    assert.ok(error instanceof ModelRequestError);
    assert.equal(error.httpStatus, 200);
    assert.equal(error.code, "credit_balance_exhausted");
    assert.match(error.message, /Add credits/);
    assert.ok(!error.message.includes("private provider text"));
    return true;
  });
  assert.ok(!messages.some(m => m.type === "model-response-end"));
});

test("HTTP rejection and standalone SSE errors are safe and actionable", async () => {
  for (const response of [
    new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }),
    stream([{ type: "error", code: "insufficient_quota" }]),
  ]) {
    await assert.rejects(forwardModelResponse(response, "request", () => {}), (e: any) => e.code === "insufficient_quota");
  }
  await assert.rejects(forwardModelResponse(stream([{ type: "response.failed", response: {
    error: { code: "unknown-sensitive-code", message: "You have no credits remaining. private" },
  } }]), "request", () => {}), (e: any) => e.code === "credit_balance_exhausted" && !e.message.includes("private"));
});

test("successful streams preserve exact bytes across UTF-8 and CRLF chunk boundaries", async () => {
  const response = stream([
    { type: "response.output_text.delta", delta: "café 🎉" },
    { type: "response.completed", response: { status: "completed" } },
  ], "\r\n");
  const original = await response.clone().text();
  const messages: any[] = [];
  await forwardModelResponse(response, "request", m => messages.push(m));
  assert.equal(Buffer.concat(messages.filter(m => m.type === "model-response-chunk").map(m => Buffer.from(m.body, "base64"))).toString(), original);
  assert.equal(messages.at(-1).type, "model-response-end");
});

test("truncated and incomplete streams cannot be reported as complete", async () => {
  for (const [events, code] of [
    [[{ type: "response.created" }], "stream_incomplete"],
    [[{ type: "response.incomplete" }], "response_incomplete"],
  ] as const) {
    await assert.rejects(forwardModelResponse(stream([...events]), "request", () => {}), (e: any) => e.code === code);
  }
});
