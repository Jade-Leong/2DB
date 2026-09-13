# Docker setup checkpoint — September 12, 2026

Docker Desktop Linux engine 29.1.3 is running. Image `twodb-agent:0adc2aafd405873e5197`, resolved SHA `96d58df8e5769d2f453e5c318c9fcdce8034537a7293145419f206e97c2f0f08`, passed the non-root, read-only, network-none and Chromium probe.

The first end-to-end run (`f4b2b246-7267-4922-bc29-9f97f8559195`) ran baseline tests but lost structured evidence from container tmpfs after exit. The controller correctly reported Inconclusive. The existing adapter was repaired to mount a dedicated evidence directory into the trusted verifier only. Candidate containers cannot access it. No marketplace code changed.

Rerun `64dc913d-af7c-4281-ab3e-bbb4e0f0e401` passed adapter validation:

| Check | Actual result |
| --- | --- |
| Baseline typecheck/build | Both exit 0 |
| Baseline D01–D08 | 5 passed, 3 failed; exit 1 |
| Developer-fixed fixture typecheck/build | Both exit 0 |
| Developer-fixed fixture D01–D08 | 8 passed; exit 0 |
| K01 history and K02 photo | Both failed in both copies; exit 1 |
| Browser adapter scripted checkout | Order 3840 cents, payment 4800 cents, screenshot saved |
| Original source and manual database | Hashes unchanged |
| Controller typecheck | Passed |
| Existing deterministic Agent 1 suite | 12 passed, 0 failed |

Evidence, exact revisions, observed values, process statuses and times are in `control/data/adapter-checkpoints/64dc913d-af7c-4281-ab3e-bbb4e0f0e401/checkpoint.json`; nested `runs/` contains structured reports, logs, screenshots and traces. All referenced artifacts were checked for existence using Node (Windows PowerShell 5 directory enumeration can fail on these long artifact paths). `browser-receipt.png` records the separate browser-adapter check. The disposable validation script is `control/data/checkpoint-fixtures.ts`; rerun locally with `npx.cmd tsx control/data/checkpoint-fixtures.ts`. These ignored artifacts are not shipped to investigators.

This validation directly invoked the isolated execution adapter with trusted fixtures. It created no ticket, proposal or approval, made no model requests, and did not use the dashboard approval controls. It does not demonstrate model transport or an agent-generated fix. No Git commit or push was performed.

Next checkpoint: the user privately sets `TWO_DB_OPENAI_API_KEY` and `TWO_DB_AGENT_MODEL` in their own controller PowerShell window, then runs `npm.cmd run control:agent:status`. Follow `control/AGENT-1.md`. The same window must start the controller. No separate worker terminal is needed. Do not approve a resulting live proposal during this walkthrough.

## First live attempt and worker startup corrections

The user configured `gpt-5.4-nano`, obtained Ready, and started investigation `29c7d609-3e55-45d8-a421-e8237bfc0828`. The dashboard reported Failed at 22:50:10 UTC with no thread ID. No reproduction or proposal was claimed. The baseline had started successfully.

A credential-free isolated reproduction identified the first startup error: tsx treated `/opt/runtime/model.ts` as CommonJS and rejected its top-level await. Added a runtime-only `package.json` declaring ES modules. A deeper diagnostic then identified the SDK attempting WebSocket transport against the HTTP-only local broker (403). Configured a named `twodb` Responses provider with `supports_websockets: false` and zero transport retries, following the official Codex configuration reference. Sandbox and tool restrictions remain intact.

Rebuilt image `twodb-agent:9db44ef33b13be138376` (SHA `b4114ec440f9da1f7d10eeaceb489a9aeeac3579009b4e526abbc67d32c74d5c`) passes the isolation/Chromium probe. `npx.cmd tsx control/data/worker-start-check.ts` passes: the actual isolated SDK creates a fresh thread and emits a request for `gpt-5.4-nano` to the local broker. The diagnostic intercepts that request and does not forward it to OpenAI. No real API key or customer complaint is supplied; this tests startup and request transport only, not model acceptance or generated output. Controller typecheck and all 12 deterministic Agent 1 tests passed again.

The failed investigation is retained. The user should refresh setup status and launch a new investigation from the same ticket. The controller reads the current runtime image hash for each investigation; this runtime-only correction does not require closing the user's credential-bearing PowerShell window. No key re-entry, approval, fixture substitution, merge, deployment or push was performed. A successful live investigation remains unproven pending the next attempt.

## Second live attempt: failure after thread creation

Run `293da083-3257-452f-91fd-34d90201e6bd` failed at 23:02:04 UTC. Read-only inspection confirmed thread `01a097db-38dd-70b3-a32a-2e33717e2c1e`, one initial browser observation, no selected model actions, and an empty usage list. The previous generic error handler retained no precise cause; do not infer a Nano incompatibility, billing problem, or successful reproduction from this record.

The controller now records API HTTP rejection status and only allowlisted error-code categories, plus generic broker/worker failure events. It does not store raw API response bodies, credentials, or model prompts. This controller-code change requires Ctrl+C and `npm.cmd run control` in the user's SAME PowerShell window; do not close that window or re-enter the key. No Docker image rebuild is needed for this diagnostic change. Refresh/sign in and perform one new investigation to obtain an actionable diagnosis. Existing failed runs remain unchanged; no proposal was approved and no changes were pushed.

## Third live attempt: SDK worker failure confirmed

Run `3485b7b8-3238-4071-9948-2238de7f4871` created thread `01a097e2-a49e-7fa2-aa78-8479cf1efce6`, then recorded Worker failed at 23:10:09 UTC. No API rejection or broker failure was recorded; usage remained empty. This establishes a worker-reported failure but does not distinguish a pre-request error from a later stream/action error. Docker baseline setup succeeded. Do not blame the key, billing, or Nano without further evidence.

Added fixed, allowlisted SDK failure categories and broker request/HTTP-acceptance milestones. No raw SDK errors, prompts, key values or response bodies are exposed. Rebuilt image `twodb-agent:12ac3d46b73dad78173a` passes isolation/Chromium checks; controller typecheck and 12 regression tests pass. The user must restart the controller in the SAME credential-bearing PowerShell window before retrying. The earlier milestone-2 unchanged developer proposal is unrelated and remains untouched. Live reproduction and an agent-generated fix remain unproven.
