# Milestone 4 results

Recorded locally on 2026-09-12. These private operator results must not enter either runtime agent's workspace or prompt.

## Implemented

- Persisted investigation origin: Live Agent 1, scripted investigation plus developer-authored proposal, or direct fixture.
- Persisted verification mode: Live Agent 2 plus mandatory scripted checks, or scripted verification only.
- Real Docker scripted reproduction with fresh screenshot and receipt evidence.
- Official `@openai/agents` Agent 2 with restricted browser and trusted evidence-reader tools.
- Exact approval, revision, requirements, harness, and evidence gates.
- Separate model assessment, executed checks, and controller result.

## Executed results

- `control:check`: passed.
- `control:agent:test`: 12 passed.
- `control:agent2:test`: 8 passed. Its model integration is mocked. Regression coverage includes cancellation during mandatory checks and a late model response after cancellation.
- `control:test`: 11 passed with normal local filesystem access. The unchanged candidate failed real discount checks; the prepared fix passed all eight. Both unrelated scenarios stayed unresolved.
- `control:scripted-demo:check`: passed. Fresh browser evidence observed displayed/order 3840 cents, payment 4800 cents, discount 960 cents; zero model calls; proposal stopped awaiting approval.
- Docker isolation probe: passed after rebuilding the content-hashed image.
- Agent 2 Docker checkpoint: baseline required checks failed as expected, prepared candidate passed all eight, both environments used network-none Docker containers, and the deliberately mocked incomplete model layer left the final state Inconclusive.
- Live Agent 2: not run. The builder did not start billable verification or approve a dashboard proposal.

## Continuation cleanup

- Fixed cancellation so mandatory verification finishes persisting its evidence before Agent 2 records the cancelled result. A late model response cannot mark a cancelled run verified.
- Corrected the README's stale statement that live Agent 2 is unimplemented.
- Re-ran `control:check`, all 12 Agent 1 tests, all 8 Agent 2 tests, and `git diff --check`: passed. Previously recorded Docker and full-controller results above were not rerun for this cleanup.

## Scenario readiness

- Discount/payment mismatch: ready for scripted Agent 1 demonstration, scripted verification, and live Agent 2 when setup is ready.
- Paid order missing from history: known unresolved; no prepared candidate or Agent 2 contract in this milestone.
- Listing photo disappears: known unresolved; no prepared candidate or Agent 2 contract in this milestone.
