import test from "node:test";
import assert from "node:assert/strict";
import { classify429, inspect429, pausedMessage } from "../agent/openai-diagnostics";
import { requestModelWithRetry } from "../agent/model-transport";

test("429 diagnostics capture only selected redacted fields and preserve the response", async () => {
  const previous = process.env.TWO_DB_OPENAI_API_KEY;
  process.env.TWO_DB_OPENAI_API_KEY = "synthetic-private-credential";
  try {
    const payload = { error: { type: "tokens", code: "rate_limit_exceeded", message: "Tokens per min limit. synthetic-private-credential sk-test-secret Bearer another-secret" }, authorization: "hidden" };
    const response = Response.json(payload, { status: 429, headers: { "x-request-id": "req_test123", "retry-after": "12", authorization: "Bearer hidden" } });
    const logs: any[] = [];
    await inspect429(response, "test-model", record => logs.push(record));
    assert.deepEqual(await response.json(), payload);
    assert.equal(logs.length, 1);
    assert.deepEqual(Object.keys(logs[0]), ["httpStatus", "error", "requestId", "retryAfter", "model", "classification"]);
    assert.equal(logs[0].classification, "tokens_per_minute");
    assert.equal(logs[0].requestId, "req_test123");
    assert.equal(logs[0].retryAfter, "12");
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-private-credential|sk-test-secret|another-secret|hidden|authorization/i);
    assert.equal(pausedMessage, "Agent is briefly paused. Continuing automatically…");
  } finally { if (previous === undefined) delete process.env.TWO_DB_OPENAI_API_KEY; else process.env.TWO_DB_OPENAI_API_KEY = previous; }
});

test("classification distinguishes stated limits without guessing exhausted quota", () => {
  for (const [message, expected] of [
    ["Requests per min (RPM)", "requests_per_minute"], ["tokens_per_minute", "tokens_per_minute"],
    ["No credits remaining", "credits exhausted"], ["project_spend_limit_exceeded", "project spend limit"],
    ["organization_spend_limit_exceeded", "organization spend limit"], ["organization_usage_limit_exceeded", "organization usage limit"],
    ["insufficient_quota", "unknown"],
  ]) assert.equal(classify429({ message }), expected);
});

test("diagnostics neither retry requests nor replay completed side effects", async () => {
  let purchases = 0, requests = 0;
  const logs: any[] = [], waits: number[] = [];
  purchases++; // Controller tool completed before the next model decision.
  await assert.rejects(requestModelWithRetry(async () => {
    requests++;
    const response = Response.json({ error: { code: "rate_limit_exceeded", message: "Requests per minute" } }, { status: 429 });
    await inspect429(response, "test-model", record => logs.push(record));
    return response;
  }, "test", () => assert.fail("Failed attempts must not deliver an action"), new AbortController().signal, () => {}, async ms => { waits.push(ms); }, () => 0));
  assert.equal(requests, 3);
  assert.equal(purchases, 1);
  assert.equal(logs.length, 3);
  assert.deepEqual(waits, [10000, 20000]);
});

test("malformed 429 and log failures do not replace provider response; other statuses are ignored", async () => {
  const response = new Response("not JSON", { status: 429 });
  await inspect429(response, "test", () => { throw Error("disk unavailable"); });
  assert.equal(await response.text(), "not JSON");
  await inspect429(new Response("ok"), "test", () => assert.fail("Only 429 should be logged"));
});
