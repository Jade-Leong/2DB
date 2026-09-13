# Agent 1 safe action batching

## Live run reviewed

Read-only inspection of run `2f851f08-9e96-4bdd-82b8-fcbb8ccaaa3c`, started September 13, 2026 at 13:31 UTC, captured 30 model requests and 29 selected actions. The captured state was Waiting for model capacity. There were two source edits followed by browser actions. The old controller kept the baseline IsolatedApp alive after edits, so those browser observations did not test the patches. Its finish action also encountered a research-report validation error. This change does not relax research provenance validation.

## Execution contract

- A model response may select `batch`, with `value` containing a JSON array of 1–5 normal action objects. The controller validates the whole batch, executes sequentially, and returns one structured result. A failed step stops the batch without replaying its completed prefix. The overall 60-action budget still applies.
- Safe source actions are list/read/search. Reads are capped at 32,000 characters with explicit pagination; searches are literal and capped at 40 matching lines. Every read/search identifies its source revision. The source path allowlist still excludes secrets.
- Browser batches support navigation, inspections, screenshots, observed same-origin links, Add to bag, non-submitting text fields and demo identity selection. Unique exact label/text targets can resolve controls that appear after an earlier planned navigation. Arbitrary CSS remains forbidden.
- The browser adapter enforces the control allowlist and blocks mutating HTTP requests during safe batches, except the application's read-only POST `/api/quote`. Checkout/payment/upload/support controls require a separate explicit decision. File uploads remain unsupported by the Agent 1 action interface. Source edits cannot appear in a batch.
- Browser decisions have durable pending/completed journal entries in the investigation evidence directory. Completed results can be reused; uncertain pending outcomes are not automatically replayed. API retries operate only on the model request, never on this action dispatcher.
- Model requests are serialized with a minimum 10-second interval between starts. Existing 429 diagnostics, retry bounds and generic dashboard message are unchanged. Pacing cannot guarantee compliance with a token-per-minute quota.

## Candidate lifecycle

Every accepted edit calculates the candidate revision, closes the old app/browser, builds a new isolated candidate app, starts it, waits for its health check and initializes a fresh browser. Build failures close browser access rather than falling back to the old process. The controller checks source revision before and after browser actions. Evidence includes `environment` and `testedRevision`; candidate observations cannot satisfy the baseline reproduction gate. The run log shows the revision being rebuilt and tested.

Retests use disposable synthetic data and a fresh session. Agent 1 exploratory retests do not replace Agent 2's independent verification or human approval.

## Verification

```sh
npm run build
npm run control:check
node --import tsx --test control/tests/action-plans.test.ts control/tests/safe-actions.test.mjs control/tests/browser-observation.test.mjs control/tests/model-transport.test.ts control/tests/openai-diagnostics.test.ts
npm run control:agent:test
npm run control:agent2:test
# Optional real local Docker check, no API calls (PowerShell):
npm.cmd run control:agent:prepare
$env:TWO_DB_LOCAL_CONTAINER_TEST='1'
node --import tsx --test control/tests/candidate-session.integration.test.ts
```

The deterministic mocked discount investigation compares the same 18 actions: five browser setup actions, one checkout, reproduction, three source actions, one edit, five candidate browser actions, one candidate checkout, and finish. Before: **18 model calls**. With batching: **8 model calls**, a **56% reduction**. Both checkouts and the edit remain separate decisions. These are fixture counts, not a measured live-model speedup.

Real local Chromium checks cover safe controls and side-effect refusals. Injected lifecycle tests check build/start/health/session ordering and revision provenance. The opt-in Docker integration test exercises real safe checkout preparation, refuses a batched purchase, permits a separate simulated checkout, then changes disposable source and checks that a newly built container and browser serve the edited page under its exact revision. Broker tests inject two 429s after a completed checkout and assert exactly one payment. No billable live investigation is started by these tests.

Deployment requires updating the persistent Sandbox and rebuilding the worker image, which now includes `runtime/safe-actions.mjs`; a Vercel frontend-only deployment is insufficient. Follow ENGINEER-HANDOFF.md and check for active investigations first. No production deployment or live success is implied by local regression results.

Local validation: production build and controller TypeScript passed; 46 regression tests plus the real Docker integration test passed. Worker `twodb-agent:edb18d2bb024cdc0416a` passed Chromium isolation. Both `observation.mjs` and `safe-actions.mjs` inside the image matched the local source hashes. Production has not been updated by this change.
