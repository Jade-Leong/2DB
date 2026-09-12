# Milestone 2 — actual status

Inspected the README, package scripts, verification suite, milestone-1 results, workflow design, ticket storage, server configuration, and Git status before implementation. This folder is not a Git repository; no destructive Git commands were used. Revisions use content-hashed source snapshots.

Completed checks: controller TypeScript; isolated baseline and candidate typechecks/builds; browser review with no page errors or horizontal overflow; HTTP 403 for private/controller files through the marketplace development server; all eleven original source/asset hashes unchanged. The real ticket inbox was empty. No ticket was invented or written to the marketplace database.

Final controller test run: **11 passed, 0 failed, 0 skipped**, completed in **152.4 seconds** on 2026-09-12. Passing checks cover read-only imports, customer denial, exact approval binding, changed revisions, tampered fixtures, rejection/change requests, occupied-port protection, stale/missing evidence, browser approval controls, actual baseline/candidate execution, mobile viewport fit, and original-source preservation. `npm.cmd run control:check` also passed.

## Actual verification outcomes

| Application copy | Required discount checks | Required process exit | Known unresolved checks |
| --- | --- | --- | --- |
| Preserved baseline | 5 passed, 3 failed | 1 | History failed; photo failed |
| Approved unchanged negative control | 5 passed, 3 failed | 1 | History failed; photo failed |
| Approved developer-authored discount fix | 8 passed, 0 failed | 0 | History failed; photo failed |

The baseline was rebuilt and tested separately for each candidate run. Both known-unresolved test processes exited 1 for each environment. These remain real failing acceptance assertions; they were not skipped or marked as expected failures. The outer controller checks pass because they verify correct classification of actual negative and positive results.

For D01, baseline/unchanged copies displayed and saved a 3,840-cent order but recorded a 4,800-cent payment. The fixed copy displayed $38.40 and recorded both order and SQLite payment as 3,840 cents. Eligibility, aggregate whole-cent floor rounding, no-code checkout, invalid codes, buyer isolation, retry deduplication, and server-owned prices all passed in the fixed copy.

- Baseline/unchanged SHA-256: `c45cc25e5c6c9a2583147130a45eb165fb3ff36a3f2c9e1e2574d2734ea7b7bd`.
- Approved/tested fixed SHA-256: `62afe69b6968ad9b91f6ded1a04aae1f540637acff0bf4a8077f7b744cd03946`.
- Negative-control run: `07a3530f-55e6-4b27-8441-09698865815d` — **Failed**.
- Fixed-candidate run: `e5d79092-698f-4c78-9175-e9acae5ba4cf` — **Verified awaiting engineer review**.

Full evidence paths and expected/observed values are recorded in `control/test-results/latest.json`. Raw results, logs, screenshots, and traces are retained under the evidence directories listed there. These executions used explicit test-engineer sessions and isolated test tickets; no actual dashboard proposal was automatically approved.

Earlier execution attempts correctly refused occupied port 3001. After explicit user approval, the assistant sent Ctrl+C to its own milestone-1 marketplace session. No manual marketplace data was reset. One subsequent check found mobile evidence-view overflow; that layout was corrected and the entire controller suite rerun successfully. The temporary debug script was removed and TypeScript rechecked.

The separate dashboard remains running at http://127.0.0.1:3002. Loop Market is stopped after verification; use its unchanged `npm.cmd run dev` command when you want to submit a real complaint.

## Boundaries

The original marketplace remains buggy. Only the developer-authored candidate changes the payment amount calculation. History and photo-association defects are unchanged. Live agents, GitHub, PR creation, merge, deployment, and a hostile-code execution sandbox remain unimplemented by design.

Test artifacts are under `control/test-results/` and `control/data/controller-tests/`. Their explicit test-engineer approvals are isolated demonstrations, not approvals of real dashboard tickets. Operating instructions: `control/README.md`.

Discount fix verified in local test environment — awaiting engineer review.
