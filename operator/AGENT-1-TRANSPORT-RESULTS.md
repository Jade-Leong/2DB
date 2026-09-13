# Agent 1 transport diagnosis

Recorded September 13, 2026 after the user requested diagnosis, a fix, and a push.

- Latest saved local run `769a9559-617e-4051-85ac-a5fb849523af` opened HTTP 200 at `2026-09-12T23:17:21.049Z`, then reported `sdk_transport` without an action or usage record.
- A credential-free reproduction using the actual isolated Codex SDK returned the same `sdk_transport` category when fed HTTP 200 followed by `response.failed` with `credit_balance_exhausted`. The SDK's generic streaming error obscured the actionable provider error. This reproduces the symptom, but historical upstream content was not saved and its precise cause cannot be proven retroactively.
- The controller previously checked only HTTP status and blindly forwarded successful-status bodies. It now inspects SSE frames for failures and incomplete responses, records allowlisted error codes, and persists fixed recovery guidance as the investigation message. Raw provider messages, prompts, and credentials are not logged. Ordinary successful stream bytes are preserved.
- Four transport unit tests passed, including chunk boundaries, UTF-8, CRLF, streamed/HTTP credit errors, redaction, and incomplete streams. Controller typecheck and all 12 existing Agent 1 tests passed.
- The actual Docker-isolated Codex SDK success check passed through the new forwarding adapter using synthetic output and usage. This is transport verification, not a live model result.
- Docker failure integration checks exercise a real isolated browser and Codex worker against synthetic HTTP 200/429 credit errors. Both must finish Failed with an actionable persisted credit message, one synthetic request, no proposal, and no raw error text.
- A successful live Agent 1 investigation remains unvalidated. The hosted account's last real model request (Agent 2) reported no remaining API credits. No new paid API request was made for this fix.
