import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { voiceRouter } from "../server/voice";

async function fixture(
  options: { configured?: boolean; request?: typeof fetch } = {},
) {
  const app = express();
  app.use(
    "/voice",
    voiceRouter({
      account: (req) => {
        if (req.get("X-Demo-Account") !== "buyer-maya")
          throw Object.assign(new Error("Select an account"), { status: 401 });
        return { id: "buyer-maya" };
      },
      configuration: () =>
        options.configured
          ? { apiKey: "private-test-key", agentId: "agent-test" }
          : {},
      request:
        options.request ??
        (async () => {
          throw new Error("Unexpected network request");
        }),
    }),
  );
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(err.status ?? 500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/voice`;
  return {
    call: (
      path: string,
      method = "GET",
      headers = { "X-Demo-Account": "buyer-maya" },
    ) => fetch(url + path, { method, headers }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("voice endpoints require a demo identity and report missing configuration without calling ElevenLabs", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call("/session", "POST", {} as any)).status, 401);
    const status = await f.call("/status");
    assert.equal(status.headers.get("cache-control"), "no-store");
    assert.deepEqual(await status.json(), { available: false });
    assert.equal((await f.call("/session", "POST")).status, 503);
  } finally {
    await f.close();
  }
});
test("signed URL exchange keeps the API key server-side, rejects other origins, and throttles duplicate starts", async () => {
  let calls = 0;
  const f = await fixture({
    configured: true,
    request: async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent-test",
      );
      assert.equal(
        new Headers(init?.headers).get("xi-api-key"),
        "private-test-key",
      );
      assert.ok(init?.signal);
      return Response.json({
        signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?test=1",
      });
    },
  });
  try {
    assert.deepEqual(await (await f.call("/status")).json(), {
      available: true,
    });
    assert.equal(
      (
        await f.call("/session", "POST", {
          "X-Demo-Account": "buyer-maya",
          Origin: "https://unrelated.example",
        } as any)
      ).status,
      403,
    );
    const response = await f.call("/session", "POST");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?test=1",
    });
    assert.equal((await f.call("/session", "POST")).status, 429);
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
for (const [name, response] of [
  [
    "provider authorization failure",
    () => new Response("private-test-key", { status: 401 }),
  ],
  ["missing URL", () => Response.json({})],
  [
    "unexpected URL host",
    () => Response.json({ signed_url: "wss://unrelated.example" }),
  ],
  [
    "timeout",
    () => {
      throw new DOMException("private-test-key", "TimeoutError");
    },
  ],
] as const)
  test(`voice ${name} gives a recoverable error without exposing secrets`, async () => {
    const f = await fixture({
      configured: true,
      request: async () => response(),
    });
    try {
      const result = await f.call("/session", "POST");
      assert.equal(result.status, 502);
      assert.ok(!(await result.text()).includes("private-test-key"));
    } finally {
      await f.close();
    }
  });
