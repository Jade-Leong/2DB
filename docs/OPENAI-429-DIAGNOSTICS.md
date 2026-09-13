# OpenAI 429 operator diagnostics

Both Agent 1's HTTP broker and Agent 2's OpenAI client observe HTTP 429 responses. They append one JSON record per response to `control/private/openai-429.jsonl`. On the hosted Sandbox, that path resolves to `/persistent/private/openai-429.jsonl`. It is not exposed through dashboard APIs, included in candidate workspaces, or committed to Git. Read it using authenticated operator access to the Sandbox.

Each record contains only HTTP status, `error.type`, `error.code`, `error.message`, request ID (`x-request-id` or `request-id`), Retry-After, model, and a classification. Configured credentials, common key formats, bearer values, Authorization text, and database connection URLs are redacted. Missing values are null. Error messages are bounded. Unspecified `insufficient_quota` is classified as unknown rather than guessing which billing limit was reached.

Classifications: `requests_per_minute`, `tokens_per_minute`, `credits exhausted`, `project spend limit`, `organization spend limit`, `organization usage limit`, or `unknown`.

The diagnostics do not start runs, change retry counts or backoff, or replay tools. They inspect a cloned response; the original response still reaches the existing error handler. Agent 1's retry message is “Agent is briefly paused. Continuing automatically…”. Terminal run handling remains unchanged: this instrumentation does not implement resumable runs. HTTP 200 streams containing an error remain handled by the existing stream parser; these are not HTTP 429 log records.

Agent 1 currently asks the model for one structured action at a time, including after browser actions. That decision loop is unchanged by this diagnostic update.

Tests: `node --import tsx --test control/tests/openai-diagnostics.test.ts control/tests/model-transport.test.ts`.
