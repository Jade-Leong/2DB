import { Codex, type Thread } from "@openai/codex-sdk";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

// This process has no host mount, real credential, network interface, or app code.
const send = (value: unknown) =>
  process.stdout.write(JSON.stringify(value) + "\n");
const pending = new Map<string, import("node:http").ServerResponse>();
const proxy = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/responses") {
    res.writeHead(403).end();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2_000_000) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const id = randomUUID();
  pending.set(id, res);
  send({
    type: "model-request",
    id,
    body: Buffer.concat(chunks).toString("base64"),
  });
});
await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
mkdirSync("/tmp/agent", { recursive: true });
mkdirSync("/tmp/codex", { recursive: true });
let thread: Thread | undefined;
let active = false;
const input = createInterface({ input: process.stdin });
input.once("close", () => process.exit(0));
setTimeout(() => process.exit(1), 12 * 60_000).unref();
input.on("line", async (line) => {
  try {
    const message = JSON.parse(line);
    if (message.type === "model-response-start") {
      pending
        .get(message.id)
        ?.writeHead(message.status, { "content-type": message.contentType });
      return;
    }
    if (message.type === "model-response-chunk") {
      pending.get(message.id)?.write(Buffer.from(message.body, "base64"));
      return;
    }
    if (message.type === "model-response-end") {
      pending.get(message.id)?.end();
      pending.delete(message.id);
      return;
    }
    if (message.type !== "turn" || active) return;
    active = true;
    if (!thread) {
      const codex = new Codex({
        apiKey: "local-transport-placeholder",
        baseUrl: `http://127.0.0.1:${(proxy.address() as any).port}/v1`,
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
          CODEX_HOME: "/tmp/codex",
          TMPDIR: "/tmp",
        },
        config: {
          features: {
            shell_tool: false,
            unified_exec: false,
            apps: false,
            plugins: false,
            browser_use: false,
            browser_use_external: false,
            computer_use: false,
            multi_agent: false,
            multi_agent_v2: false,
            code_mode_host: false,
            view_image: false,
            remote_plugin: false,
            skill_search: false,
            in_app_browser: false,
            enable_request_compression: false,
            remote_compaction_v2: false,
          },
          hide_agent_reasoning: true,
          history: { persistence: "none" },
        },
      });
      thread = codex.startThread({
        model: message.model,
        workingDirectory: "/tmp/agent",
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        webSearchMode: "disabled",
        networkAccessEnabled: false,
      });
    }
    const { events } = await thread.runStreamed(message.prompt, {
      outputSchema: message.schema,
      signal: AbortSignal.timeout(120_000),
    });
    let final = "";
    for await (const event of events) {
      if (event.type === "thread.started") send(event);
      if (event.type === "turn.completed")
        send({ type: "usage", usage: event.usage });
      if (event.type === "error" || event.type === "turn.failed")
        throw new Error("SDK turn failed");
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      )
        final = event.item.text;
      if (
        event.type === "item.started" &&
        [
          "command_execution",
          "file_change",
          "mcp_tool_call",
          "web_search",
        ].includes(event.item.type)
      )
        throw new Error("Native tool use is not supported by this broker");
    }
    send({ type: "action", action: JSON.parse(final) });
  } catch {
    send({
      type: "failed",
      message:
        "Model worker failed or returned invalid structured output. Check authentication, selected model, and SDK compatibility.",
    });
  } finally {
    active = false;
  }
});
