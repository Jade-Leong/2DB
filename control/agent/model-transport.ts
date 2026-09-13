import { setTimeout as delay } from "node:timers/promises";
// Retain only fixed error codes and messages; never persist provider response text.
const codes = new Set([
  "credit_balance_exhausted",
  "insufficient_quota",
  "rate_limit_exceeded",
  "organization_usage_limit_exceeded",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "model_not_found",
  "invalid_api_key",
  "unsupported_parameter",
  "unsupported_value",
  "invalid_json_schema",
  "invalid_request_error",
  "permission_denied",
  "server_error",
]);

export class ModelRequestError extends Error {
  rateLimits: Record<string, string> = {};
  constructor(
    public code: string,
    public httpStatus: number,
  ) {
    const message =
      code === "credit_balance_exhausted"
        ? "OpenAI API credits are exhausted. Add credits to the API organization used by this controller, then retry."
        : code === "insufficient_quota" ||
            /(?:spend|usage)_limit_exceeded$/.test(code)
          ? "OpenAI API quota or spending limit was reached. Check the configured API organization's billing and limits, then retry."
          : code === "rate_limit_exceeded"
            ? "OpenAI API rate limit was reached. Wait before retrying."
            : code === "invalid_api_key" || code === "permission_denied"
              ? "OpenAI API authentication or permission failed. Check the controller's configured credential."
              : code === "model_not_found"
                ? "The configured OpenAI model is unavailable to this API project. Check model access."
                : code === "stream_incomplete"
                  ? "The OpenAI response stream ended without a completed response. No model action was accepted. Retry the investigation."
                  : code === "response_incomplete"
                    ? "OpenAI returned an incomplete response. No model action was accepted."
                    : "OpenAI could not complete the model request. Review the recorded error code and model configuration.";
    super(message);
  }
}

export function rateLimitHeaders(response: Response) {
  const result: Record<string, string> = {};
  for (const name of [
    "retry-after",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens",
    "x-ratelimit-limit-project-tokens",
    "x-ratelimit-remaining-project-tokens",
    "x-ratelimit-reset-project-tokens",
  ]) {
    const value = response.headers.get(name);
    if (
      value &&
      value.length <= 40 &&
      /^[0-9.]+(?:ms|s|m|h|d)?(?:[0-9.]+(?:ms|s|m|h|d))*$/.test(value)
    )
      result[name] = value;
  }
  return result;
}

// Buffer each attempted response until completion so a failed attempt cannot
// leak a partial action into the SDK. Retry model requests, never browser actions.
export async function requestModelWithRetry(
  request: () => Promise<Response>,
  id: string,
  send: Send,
  signal: AbortSignal,
  onRetry: (
    attempt: number,
    delayMs: number,
    rateLimits: Record<string, string>,
  ) => void,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, s) =>
    delay(ms, undefined, { signal: s }),
  random: () => number = Math.random,
) {
  let totalWaitMs = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const response = await request();
    const messages: Record<string, unknown>[] = [];
    let bytes = 0;
    try {
      await forwardModelResponse(response, id, (message) => {
        bytes += typeof message.body === "string" ? message.body.length : 0;
        if (bytes > 8_000_000)
          throw new ModelRequestError(
            "stream_event_too_large",
            response.status,
          );
        messages.push(message);
      });
      signal.throwIfAborted();
      for (const message of messages) send(message);
      return;
    } catch (error) {
      if (error instanceof ModelRequestError)
        error.rateLimits = rateLimitHeaders(response);
      if (
        signal.aborted ||
        !(error instanceof ModelRequestError) ||
        error.code !== "rate_limit_exceeded" ||
        attempt === 2
      )
        throw error;
      const header = response.headers.get("retry-after");
      const requested =
        header === null
          ? 0
          : /^\d+(\.\d+)?$/.test(header)
            ? Number(header) * 1000
            : Date.parse(header) - Date.now();
      // A larger wait cannot fit our bounded turn. Report the rate limit honestly.
      if (Number.isFinite(requested) && requested > 60_000) throw error;
      const delayMs = Math.max(
        10_000 * 2 ** attempt + Math.floor(random() * 1000),
        Number.isFinite(requested) ? requested : 0,
      );
      if (totalWaitMs + delayMs > 90_000) throw error;
      totalWaitMs += delayMs;
      onRetry(attempt + 1, delayMs, rateLimitHeaders(response));
      await wait(delayMs, signal);
    }
  }
}

function errorCode(value: any) {
  if (codes.has(value?.code)) return value.code as string;
  // Some API failures use a generic code with the credit explanation in message.
  if (
    typeof value?.message === "string" &&
    /no credits remaining|credit balance.*exhausted/i.test(value.message)
  )
    return "credit_balance_exhausted";
  return "unclassified";
}

type Send = (message: Record<string, unknown>) => void;
export async function forwardModelResponse(
  response: Response,
  id: string,
  send: Send,
) {
  if (!response.ok) {
    let code = "unclassified";
    try {
      code = errorCode((await response.json()).error);
    } catch {}
    throw new ModelRequestError(code, response.status);
  }
  const contentType = response.headers.get("content-type") || "";
  if (
    !contentType.toLowerCase().includes("text/event-stream") ||
    !response.body
  )
    throw new ModelRequestError("unexpected_response_type", response.status);
  send({
    type: "model-response-start",
    id,
    status: response.status,
    contentType,
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    completed = false;
  function inspect(text: string) {
    buffer += text;
    for (;;) {
      const separator = /\r?\n\r?\n/.exec(buffer);
      if (!separator) break;
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        throw new ModelRequestError("invalid_stream_event", response.status);
      }
      if (
        event.type === "error" ||
        event.type === "response.failed" ||
        event.response?.status === "failed"
      )
        throw new ModelRequestError(
          errorCode(event.response?.error ?? event.error ?? event),
          response.status,
        );
      if (event.type === "response.incomplete")
        throw new ModelRequestError("response_incomplete", response.status);
      if (event.type === "response.completed") completed = true;
    }
    if (buffer.length > 2_000_000)
      throw new ModelRequestError("stream_event_too_large", response.status);
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Detect terminal provider errors before the SDK obscures them as transport errors.
      inspect(decoder.decode(value, { stream: true }));
      send({
        type: "model-response-chunk",
        id,
        body: Buffer.from(value).toString("base64"),
      });
    }
    inspect(decoder.decode());
    if (!completed)
      throw new ModelRequestError("stream_incomplete", response.status);
    send({ type: "model-response-end", id });
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
