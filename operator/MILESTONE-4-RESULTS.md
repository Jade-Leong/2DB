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
- Live Agent 2: attempted on the hosted deployment after the user requested testing. The prepared candidate passed all eight mandatory Docker checks, then OpenAI returned HTTP 429: no API credits remaining. The controller recorded Inconclusive and retained scripted evidence. A successful live model assessment remains unvalidated.

## Continuation cleanup

- Fixed cancellation so mandatory verification finishes persisting its evidence before Agent 2 records the cancelled result. A late model response cannot mark a cancelled run verified.
- Corrected the README's stale statement that live Agent 2 is unimplemented.
- Re-ran `control:check`, all 12 Agent 1 tests, all 8 Agent 2 tests, and `git diff --check`: passed. Previously recorded Docker and full-controller results above were not rerun for this cleanup.

## Scenario readiness

- Discount/payment mismatch: ready for scripted Agent 1 demonstration, scripted verification, and live Agent 2 when setup is ready.
- Paid order missing from history: known unresolved; no prepared candidate or Agent 2 contract in this milestone.
- Listing photo disappears: known unresolved; no prepared candidate or Agent 2 contract in this milestone.

## Deployment verification

- Pushed application commit `1273cf4` to `origin/main` and deployed production to https://twodb-steel.vercel.app/ (Vercel deployment `dpl_3jhBmuDmmt1qYCZpmYtrcvYtM2rT`). Updated the persistent Sandbox backend from the same application source.
- Fresh checks passed: production build, controller typecheck, 11 controller tests, 12 Agent 1 tests, 8 Agent 2 tests, scripted Docker reproduction, and the Agent 2 Docker checkpoint with mocked model assessment.
- Public smoke checks passed: both pages, marketplace health and products, engineer authentication, authenticated inbox, cross-origin rejection, and private-file protection. Cold-start requests briefly returned 503 before the backend became available. Persistence remains hosted SQLite; Supabase production variables are absent.
- Hosted test complaint `23dd6bf1-933a-4d44-b544-8fb68478c28c`, proposal `4a0ee857-8cae-4984-a43b-1a93b87a412d`, run `8626e6d8-3eaa-4744-85fc-53413bafdf25`. Exact prepared-revision approval was explicitly performed for this user-authorized deployment test.
- The polling script timed out, but subsequent persisted-run inspection established that the backend completed at `2026-09-13T03:04:57.941Z` with the API credit error above. Do not describe the live model as passed or silently substitute scripted success.
