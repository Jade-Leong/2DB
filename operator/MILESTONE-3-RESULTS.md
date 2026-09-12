# Milestone 3 implementation and actual results

Recorded 2026-09-12. Source: commands actually executed during implementation. This is an operator report, excluded from investigator handoffs.

## Implemented

- Official `@openai/codex-sdk` 0.154.0 TypeScript backend worker, fresh `startThread()` per investigation, `runStreamed()` with structured action output, explicit environment, configurable model, and reported token usage.
- Separate model/browser/application container adapters with non-root/read-only/network-none policies, a fixed OpenAI transport broker, no real model key inside containers, and a real runtime/Chromium readiness probe.
- Engineer-only investigation routes, persistent states/events, duplicate prevention, cancellation, 60-action/12-minute bounds, evidence downloads, and setup/readiness UI.
- Application-only handoff; scoped file tools deny traversal, symlinks/hardlinks, private paths, and non-source edits. Reproduction must precede source inspection and edits.
- Trusted browser checkout/receipt observations and screenshots gate reproduction. No model-supplied “reproduced” claim or manually posted result is accepted as evidence.
- Agent-generated local proposals with controller-computed source hashes/diff, frozen independent requirements, thread/run IDs, browser evidence, likely cause/source references, uncertainty, and suggested verification. Exact human approval is required before executing a generated candidate.
- Generated candidates cannot enter the existing host fixture runner. Their independent verification adapter uses separate application and trusted-verifier containers, sharing only disposable application data and the assigned isolated network namespace.
- Preserved original marketplace source, saved manual database, existing developer fixtures, and normal npm commands. Live Agent 2 and GitHub PR integration remain unimplemented.

## Actual checks

| Command/check | Result |
| --- | --- |
| `npm.cmd run control:check` | Passed |
| `npm.cmd run build` | Passed; original marketplace production build |
| `npm.cmd run control:agent:test` | 12 passed, 0 failed, 0 skipped; deterministic tests, no model invocation |
| `npm.cmd run control:test` | 11 passed, 0 failed, 0 skipped; latest completed regression run took 219.4 seconds |
| Original `src/`, `server/`, and `public/` hashes | All 11 preserved original file hashes match |
| Read-only ticket adapter and saved manual data | Unchanged across Agent 1 tests |
| Agent 1 desktop/mobile UI | Passed browser checks; no page errors or horizontal mobile overflow |
| Actual running controller readiness API | SDK available; **Setup required** for worker authentication/model and Docker Linux engine |

The deterministic tests inject setup failures and use an **explicit test-engineer session**. A synthetic agent-proposal test exercises evidence/approval invalidation against its own database; it is labeled synthetic and does not establish a live discovery. No real dashboard proposal was auto-approved. The actual controller had zero live investigation records when checked.

## Real scripted baseline/fixture results

The independent acceptance assertions still assert intended correct behavior. They are not skipped, inverted, retried to hide failures, or marked as expected failures.

| Environment | Required discount checks | Separate known scenarios |
| --- | --- | --- |
| Original baseline | 5 passed / 3 failed: D01, D02, D03; test process exit 1 | K01 history and K02 photo fail |
| Approved unchanged developer fixture | 5 passed / 3 failed: D01, D02, D03; exit 1 | K01 and K02 fail |
| Approved developer-authored discount fixture | 8 passed / 0 failed; exit 0 | K01 and K02 fail |

Baseline D01 records an order of **3840 cents** and payment of **4800 cents**. The developer fixture records both as **3840 cents**. These are scripted fixture results, **not an Agent 1 fix**.

Latest completed regression evidence:

- Started: `2026-09-12T21:50:56.436Z`; finished: `2026-09-12T21:54:34.375Z`.
- Negative-control run: `d6296b30-22bb-424c-aeb5-b75e137822a6` — Failed.
- Developer-fixed run: `0523dadc-262f-4591-8937-4fdde503a96c` — Verified awaiting engineer review.
- Base/unchanged SHA-256: `c3c6e6a97d272bf04641866eb7c5dfa40abdab2f12110a390f7ca6e71320533e`.
- Developer-fixed SHA-256: `cb45f95dd96b2da454358853db713cdce40286350cbe038e5ac607ea4c4399bc`.
- Local summary: `control/test-results/latest.json`; full evidence stays under the corresponding `control/data/controller-tests/` run directory and remains gitignored.
- UI artifacts: `control/test-results/agent/setup-desktop.png` and `setup-mobile.png` (synthetic test controller, not a live model run).

A final handoff-document regular-file check was added after that regression run; the Agent 1 checks and typecheck were rerun for it. It does not change the legacy fixture execution path. Harness identities intentionally change whenever trusted controller/agent code changes; old evidence cannot approve a newer harness revision.

## Live execution: not demonstrated

Actual Docker checks reported the `dockerDesktopLinuxEngine` named pipe missing. Docker is installed, but the Linux engine was not available. The separate `TWO_DB_OPENAI_API_KEY` and `TWO_DB_AGENT_MODEL` variables were not configured. SDK detection was verified with its actual ESM export, not a CommonJS-only lookup.

Consequently:

- No paid model call or live SDK thread was started.
- No live reproduction, model-created fix, or live proposal awaiting review exists yet.
- The Docker image build, actual container/browser probe beyond the engine precheck, stdio model-service transport, and generated-candidate verification have **not been exercised end to end on this machine**. These implemented adapters need that setup validation; compatibility/startup failures may still require follow-up. There is no unsafe host fallback.
- Deterministic file-boundary/policy checks passed; they must not be described as proof that an unavailable Docker runtime was tested.
- No agent conversation, discovery, passing result, or estimated dollar cost was fabricated. No failed attempt was replaced by a known-good fixture.

Follow [the operating guide](../control/AGENT-1.md): start Docker Desktop's Linux engine, prepare/probe the image, privately configure the worker API key and a supported model in the controller terminal, submit the stated discount complaint, and use **Investigate with Agent 1**. Review the resulting actual diff yourself. Investigation authorization never approves the future candidate.

The remaining planned stages are live Agent 2, actual GitHub PR creation, human merge review, and deployment controls. Source publication to the private repository is a developer action, not runtime GitHub integration.
