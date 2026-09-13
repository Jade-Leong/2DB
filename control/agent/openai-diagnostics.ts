import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { controlRoot } from "../paths";

export const pausedMessage = "Agent is briefly paused. Continuing automatically…";

export function classify429(error: any) {
  const text = [error?.type, error?.code, error?.message].filter(v => typeof v === "string").join(" ").toLowerCase();
  if (/credit_balance_exhausted|credits? (?:are )?exhausted|no credits remaining/.test(text)) return "credits exhausted";
  if (/project[_ ]spend[_ ]limit/.test(text)) return "project spend limit";
  if (/organization[_ ]spend[_ ]limit/.test(text)) return "organization spend limit";
  if (/organization[_ ]usage[_ ]limit/.test(text)) return "organization usage limit";
  if (/tokens[_ ]per[_ ]min|\btpm\b/.test(text)) return "tokens_per_minute";
  if (/requests[_ ]per[_ ]min|\brpm\b/.test(text)) return "requests_per_minute";
  return "unknown";
}

function redact(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && secret.length >= 4 && /KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|DB_URL/i.test(name))
      text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/\b(?:sk-|tvly-|sb_secret_)[a-z0-9_-]+/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "[redacted]")
    .replace(/Authorization\s*[:=]\s*[^\r\n]*/gi, "[redacted]")
    .replace(/(?:postgres(?:ql)?):\/\/[^\s"']+/gi, "[redacted]")
    .slice(0, 8000);
}

function operatorLog(record: unknown) {
  const directory = path.join(controlRoot, "private");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  appendFileSync(path.join(directory, "openai-429.jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 });
}

// Observe a cloned response only. Never retry here or consume the SDK's body.
export async function inspect429(response: Response, model: string, log: (record: any) => void = operatorLog) {
  if (response.status !== 429) return;
  let error: any = {};
  try {
    const reader = response.clone().body?.getReader();
    if (reader) {
      let text = "";
      const decoder = new TextDecoder();
      const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 1000);
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          text += decoder.decode(part.value, { stream: true });
          if (text.length > 32_768) break;
        }
        if (text.length <= 32_768) error = JSON.parse(text).error ?? {};
      } finally {
        clearTimeout(timer);
        void reader.cancel().catch(() => {});
      }
    }
  } catch { /* Missing/malformed bodies still yield status and headers. */ }
  try {
    log({ httpStatus: response.status, error: { type: redact(error.type), code: redact(error.code), message: redact(error.message) },
      requestId: redact(response.headers.get("x-request-id") ?? response.headers.get("request-id")),
      retryAfter: redact(response.headers.get("retry-after")), model: redact(model), classification: classify429(error) });
  } catch { /* Diagnostics must not alter request/retry outcomes. */ }
}

export function diagnosticFetch(model: string, transport: typeof fetch = fetch): typeof fetch {
  return (async (...args: Parameters<typeof fetch>) => {
    const response = await transport(...args);
    await inspect429(response, model);
    return response;
  }) as typeof fetch;
}
