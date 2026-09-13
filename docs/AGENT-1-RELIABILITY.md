# Agent 1 reliability update

This update addresses the September 13 investigation that stopped with `rate_limit_exceeded` after 25 browser actions.

## Changes

- The browser adapter returns unique, stable `data-2db-ref` selectors for visible controls. Click/fill/select accepts only selectors from its latest observation. Failed actions return fresh controls so the model can recover without an extra inspection.
- Reading the checkout total no longer waits eight seconds when the element is absent. Same-origin absolute navigation is accepted; other origins remain forbidden.
- The full browser record remains in the evidence directory. The model receives bounded page text, five recent response summaries, and the measured checkout/receipt values. Unchanged page text and controls are omitted on subsequent turns.
- The controller retries only explicit OpenAI `rate_limit_exceeded` errors, at most twice, with delayed exponential backoff, jitter, and `Retry-After`. Waits are capped at 90 seconds total; a server delay above 60 seconds is deferred rather than retried early. Quota exhaustion and authorization failures are not retried.
- Each attempted model response is buffered until it completes. Failed partial responses never reach the SDK, and browser actions are never replayed by the retry loop.
- The broker has one 210-second budget covering fetching, reading the complete response stream, and bounded retries. This replaces the overly short 45-second cutoff that could interrupt a healthy response. SDK/controller turn deadlines are 240/250 seconds; the investigation still has its 12-minute overall limit. Cancellation aborts HTTP requests and retry waits. Broker deadline expiry is recorded explicitly as `model_request_timeout`, not a generic network failure.
- Logs distinguish engineer cancellation from duration expiry, retain fixed worker failure categories, and include an allowlist of numeric rate-limit headers when available. Provider error bodies and credentials are not logged.

## Deployment handoff

Pull the commit containing this document into the authenticated deployment checkout. Update the source in the existing persistent Sandbox **twodb-host-runtime**, rebuild its isolated agent image with `npm run control:agent:prepare`, and restart the controller using its existing private configuration. Follow the established Sandbox provisioning procedure in `docs/ENGINEER-HANDOFF.md`; preserve the persistent Drive, tickets, credentials, and evidence.

**Deploying the Vercel frontend alone does not update Agent 1.** Both `control/agent/runtime/browser.mjs` and `model.ts` changed, and the new `runtime/observation.mjs` must be copied into the rebuilt image. The existing image-content hash will detect these changes.

Check that no investigation or verification is active before restarting. After deployment, confirm the isolation/browser setup reports Ready, then start one new investigation from the hosted dashboard. Watch for exact element references and any **Waiting for model capacity** events. A successful local regression suite does not prove a successful live model investigation; record the actual result before presenting the agent as working end to end.

## Regression commands

```sh
npm run control:check
node --import tsx --test control/tests/model-transport.test.ts control/tests/browser-observation.test.mjs
npm run control:agent:test
```

The focused tests use synthetic OpenAI streams and a real local Chromium page. They check unique targeting, stable references, compact observations, discarded partial responses, Retry-After, bounded attempts, non-retriable quota, and cancellation. No model, prompt, or credential was changed to increase account limits.

Verification at handoff: TypeScript passed; all eleven focused checks passed, including stalled-stream deadline handling and cancellation; the eleven non-UI Agent 1 checks passed for the preceding reliability update. The existing dashboard test still expects the removed “Investigate with Agent 1”/Tavily setup controls and times out against the redesigned interface, including on the committed UI baseline. That older UI test needs alignment with the separate workspace redesign. No successful production model run is claimed for this update before the hosted worker is rebuilt and tested.

Reference: https://developers.openai.com/api/docs/guides/rate-limits

## Partial completion reports

The first hosted run of `7b74e16` reproduced the $38.40 order / $48.00 payment mismatch with trusted browser evidence, then prepared an edit. It repeatedly failed completion-report validation and was cancelled by the deployment operator to stop the loop. No rate-limit recovery events were recorded in that run; no successful proposal or verified fix is claimed.

Completion reports now accept omitted narrative fields for engineer review. Missing causes and uncertainties are explicitly marked as not provided, missing verification advice receives an engineer-approval reminder, and missing source references are derived from the actual changed files. Metadata records `missingFields`. The prompt documents the JSON structure in the finish action's `value`. Provided source references still must identify permitted existing application files, and supplied text remains bounded.

This does not waive trusted reproduction, evidence integrity, source integrity, exact-revision approval, or independent verification. A partial report creates an unexecuted proposal awaiting engineer approval, never an automatically applied fix. Research citations retain their separate provenance checks.

Additional regression command: `node --import tsx --test control/tests/finish-report.test.ts`.
