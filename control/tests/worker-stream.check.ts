import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { JsonProcess, hardening, imageTag, docker } from "../agent/docker";
import { actionSchema } from "../agent/policy";
import { forwardModelResponse } from "../agent/model-transport";

// Synthetic transport fixture only: never forwards a request to a model service.
const name = "twodb-streamcheck-" + randomUUID();
const worker = new JsonProcess([
  "run", "--rm", "-i", ...hardening(name), imageTag(), "node", "--import",
  "/app/node_modules/tsx/dist/loader.mjs", "/opt/runtime/model.ts",
]);
const action = { action: "needs_information", target: "", value: "", summary: "Synthetic transport check: café." };
const output = JSON.stringify(action);
const item = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: output, annotations: [] }] };
const response = { id: "resp_fixture", object: "response", created_at: 1, model: "gpt-5.4-nano", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
const events = [
  { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
  { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
  { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
  { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: output },
  { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: output },
  { type: "response.output_item.done", output_index: 0, item },
  { type: "response.completed", response },
];
let usage: unknown;
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Synthetic stream timed out")), 30000);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    worker.onFailure = fail;
    worker.onMessage = (message) => {
      try {
        if (message.type === "model-request") {
          const request = JSON.parse(Buffer.from(message.body, "base64").toString());
          assert.equal(request.stream, true);
          const stream = Buffer.from(events.map((e, sequence_number) => `event: ${e.type}\ndata: ${JSON.stringify({ ...e, sequence_number })}\n\n`).join(""));
          // Deliberately split JSON, SSE boundaries and UTF-8 sequences across IPC chunks.
          const response = new Response(new ReadableStream({ start(controller) {
            for (let offset = 0; offset < stream.length; offset += 7)
              controller.enqueue(stream.subarray(offset, offset + 7));
            controller.close();
          } }), { headers: { "content-type": "text/event-stream" } });
          void forwardModelResponse(response, message.id, value => worker.send(value)).catch(fail);
        }
        if (message.type === "usage") usage = message.usage;
        if (message.type === "failed") fail(new Error("Worker failure: " + message.category));
        if (message.type === "action") {
          assert.deepEqual(message.action, action);
          assert.ok(usage);
          clearTimeout(timer); resolve();
        }
      } catch (e) { fail(e as Error); }
    };
    worker.send({ type: "turn", model: "gpt-5.4-nano", prompt: "Synthetic transport test only.", schema: actionSchema });
  });
  console.log("PASS: synthetic SSE stream -> isolated Codex SDK -> exact structured action and synthetic usage. No paid API request.");
} finally {
  worker.child.stdin.end();
  await docker(["rm", "-f", name]);
}
