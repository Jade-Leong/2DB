# 2DB — local engineer review

**Two agents. One reproducible bug.**

The current live Agent 2 and scripted Agent 1 workflows are documented in [AGENT-2.md](AGENT-2.md). It includes persisted mode labels, private `TWO_DB_AGENT_2_MODEL` setup, exact PowerShell windows, Docker setup, dashboard actions, and current limitations.

Milestone 2 adds a separate local control application. Loop Market remains intact, including all three original intentional defects. Milestone 3 adds the separate Agent 1 integration described in [AGENT-1.md](AGENT-1.md). The current workflow adds live Agent 2, an explicit scripted Agent 1 demonstration, and the 2DB Bridge GitHub App. After human approval, the App can create a branch and pull request from the approved diff; GitHub review, merge, and deployment remain human-controlled. See [the GitHub setup and test procedure](../README.md#from-customer-ticket-to-github-pull-request).

## PowerShell setup and startup

Node.js 24+ is required. The controller uses the existing installed Express, TypeScript, SQLite, and Playwright dependencies; there is no separate package install or monorepo setup.

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run control
```

Open **http://127.0.0.1:3002**. This is separate from Loop Market:

| Application | Address | Command |
| --- | --- | --- |
| 2DB dashboard + API | http://127.0.0.1:3002 | `npm.cmd run control` |
| Loop Market development frontend | http://127.0.0.1:5173 | `npm.cmd run dev` |
| Marketplace API / built production site | http://127.0.0.1:3001 | API starts with dev; or `npm.cmd run build` then `npm.cmd start` |

If 3002 is occupied, the controller exits without stopping that process. Choose an unused port explicitly, for example:

```powershell
$env:CONTROL_PORT = "3003"
npm.cmd run control
```

Use the address printed by that command. To restore the default for the next launch, run `Remove-Item Env:CONTROL_PORT`.

## Open the local engineer session

Keep the controller running. In another PowerShell window:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
npm.cmd run control:engineer
```

Copy the displayed local engineer key into **Local engineer key** on the 2DB page, then select **Open engineer session**. The key is generated on first controller startup and stored only in the gitignored `control/private/engineer-key.json`. Do not copy it into a complaint, proposal, screenshot, or test log.

The controller issues a separate random bearer session, stored in the dashboard tab's sessionStorage. Sessions expire after eight hours and are invalidated when the controller restarts. The backend assigns the reviewer **Local engineer**; a frontend role or marketplace `X-Demo-Account` header cannot grant review privileges. Mutation requests from another origin are rejected. There is no shared marketplace login or cookie.

This is a **local demo approval mechanism, not production authentication**. Local filesystem access to the controller key grants engineer access. The key and controller data must remain outside any future candidate workspace.

## Submit and import a real complaint

1. Run Loop Market with its existing `npm.cmd run dev` command.
2. Open http://127.0.0.1:5173, select Maya or Jamie, and open **Support**.
3. Submit a subject and complaint, such as “I used a discount code, but I was charged the full price.” This is a real local support-ticket submission.
4. Open 2DB, sign in as the local engineer, and select **Refresh** in **Ticket inbox**.
5. Select the submitted ticket. Choose either **Use discount sample fix** or **Use unchanged negative control** to import a frozen complaint copy and create a proposal.

The adapter opens `data/local/market.sqlite` with SQLite `readOnly: true` and `PRAGMA query_only=ON`. It never imports the marketplace server module, seeds, writes, or resets the source database. It preserves the original ticket ID, customer ID/name/role, subject, complaint, and submission timestamp in its own SQLite database. The existing schema has no related-record column; 2DB displays that fact rather than inventing one. References typed in a complaint remain part of the unmodified complaint text.

Imported tickets survive a later marketplace reset. Resetting Loop Market is **not needed** for controller verification and must not be used to free the port. An empty real inbox is shown honestly; test complaints are kept in separate controller-test data and are not inserted into the marketplace.

## Review and approve a candidate

Both options are explicitly **developer-authored** fixtures, not agent discoveries:

- **Discount sample fix:** changes one payment-recording line in an isolated source snapshot. It retains server-owned pricing, LOOP20 eligibility, whole-cent rounding, zero taxes/shipping, and buyer-scoped retry deduplication.
- **Unchanged negative control:** byte-for-byte identical to the baseline. It must fail the discount checks even after approval.

The original marketplace source is never patched. Review the full base/candidate SHA-256 identifiers, frozen requirements, explanation, and actual code diff. The source snapshot includes file paths and file-content hashes; timestamps are not used as revision identities.

For each sample candidate:

1. Inspect its **Local change proposal** and source diff.
2. Agent 2 starts automatically to test the exact revision and flag concerns. Use **Start Agent 2** only if the automatic handoff was deferred.
3. Review Agent 2's evidence, then select **Approve**, **Request changes**, or **Reject proposal**.
4. Human approval records the reviewer, timestamp, exact candidate revision, and revision counter in the **Approved** queue for human PR preparation.
5. Replacing the candidate invalidates prior verification. An on-disk edit to a frozen fixture is detected before execution and refused; unreviewed code is never executed.

Approval does not create, merge, or deploy code. It queues the Agent 2-reviewed proposal in **Approved**. An engineer can then use the separately authorized GitHub tab to create a pull request; approval by itself performs no repository write.

## Run actual baseline-versus-candidate verification

**Stop Loop Market with Ctrl+C in its terminal first. Leave 2DB running.** The existing API port 3001 must be free. If occupied, the controller shows exactly:

> Stop Loop Market with Ctrl+C, then retry verification.

It does not kill the listener or reset the active marketplace. After freeing the port, select **Run scripted verification** on the approved proposal.

The trusted runner performs these steps serially:

1. Copy the frozen baseline into a fresh disposable application directory.
2. Type-check and build that copy using the installed, trusted TypeScript/Vite binaries.
3. Run the required discount checks with the independent Playwright harness, then the separate known-unresolved checks.
4. Repeat in a separate fresh copy for the **approved candidate**.
5. Verify source and harness hashes again and evaluate the actual test results.

The harness stays in the original `verification/` directory, outside candidate code. `control/playwright.config.ts` adapts the existing conventions: built site, fixed API port 3001, no existing-server reuse, serial tests, zero retries, and `LOOP_TEST=1`. The only adaptation to the existing helper is an optional controller-supplied application-root path; without it, all original commands behave as before.

Each test resets only its disposable copy's `data/test/`. The copies contain no manual `data/local/` database. No credentials are passed to test processes. Only an explicit set of ordinary Windows environment variables and the controller's run identifiers are supplied. Process cleanup is limited to a runner's own child process tree on timeout; unrelated listeners are never stopped.

The dashboard polls progress and records every state transition. A typical full baseline/candidate pair takes a few minutes. The dashboard remains available on its separate port throughout.

## What the discount ticket requires

| ID | Required behavior |
| --- | --- |
| D01 | $48 knit + LOOP20: displayed total, order, HTTP payment, and SQLite payment are all $38.40 |
| D02 | Two knits plus the ineligible lamp: subtotal 16,100 cents, discount 1,920, order/payment 14,180 |
| D03 | Eligible prices 4,803 + 3,203 cents: combined floor discount 1,601; order/payment 6,405 |
| D04 | Two knits without a discount: order/payment 9,600 cents |
| D05 | Invalid code: no discount and order/payment 4,800 cents |
| D06 | Owner can access the receipt; another buyer receives 404 |
| D07 | Same buyer/request key reuses one order/payment; another buyer has a distinct checkout |
| D08 | Client-submitted prices/payment amounts are ignored; buyers cannot edit listing prices |

The checks use the receipt/order-detail workflow, not order history. K01 (history) and K02 (photo persistence) run as separate known-unresolved checks. Their failure remains visible and does not mean the discount fix failed. Missing or interrupted evidence from either suite makes the overall run inconclusive. A discount pass is never described as “all bugs fixed.”

## Read the evidence

Open **Evidence, side by side** on a proposal. Each required row shows status, frozen expected values, and actual observed values for the baseline and candidate. Expand the process sections to download typecheck/build/test logs, structured results, receipt screenshots, or Playwright traces. The run ID, revision, process exit codes, test identifiers, start/finish times, errors, and artifacts are retained in `control/data/local/runs/` and the controller database.

Artifacts are served only through the engineer-authorized API. No endpoint accepts a manually entered passing result. Duplicate/missing checks, skipped tests, expected-failure annotations, empty output, setup failures, test timeouts, changed sources, stale approvals, or mismatched run/revision/harness identities cannot produce verification. Changing a revision archives its old evidence; that evidence is not applied to the new revision.

To inspect a downloaded trace:

```powershell
npx.cmd playwright show-trace "C:\path\to\trace.zip"
```

Final success is **Verified awaiting engineer review**, with the message: **Discount fix verified in local test environment — awaiting engineer review.** That is the end of this milestone's workflow.

## Controller checks

Milestone-2 recorded result: **11 controller tests passed**, with no skips. In the actual independent runs, the baseline and approved unchanged candidate each had **5 required passes / 3 required failures**. The approved discount fix had **8 required passes**. Both history and photo checks continued to fail separately. See [the operator results](../operator/MILESTONE-2-RESULTS.md) and `control/test-results/latest.json` for run IDs and observed values.

Stop the manual marketplace first. The real 2DB dashboard can remain running because tests create their own controller on an ephemeral loopback port and use separate test credentials and data.

```powershell
npm.cmd run control:check
npm.cmd run control:test
```

These checks exercise backend authorization, exact approval binding, revision changes, rejection/change requests, fixture tampering, port occupancy, missing/stale evidence, read-only ticket import, and actual approved negative/fixed candidates. Test approvals use an **explicit test-engineer session**; they do not approve any real dashboard proposal. Test artifacts and a demonstration summary are under `control/test-results/` and `control/data/controller-tests/`. The dashboard labels that summary separately from real tickets.

To see the already completed demonstration, refresh 2DB and expand **Controller automated demonstration · explicit test-engineer session**. It shows the negative and fixed outcomes with actual observed values. For a real ticket's new run, use its **Evidence, side by side** table and download buttons.

Original `npm.cmd test`, `npm.cmd run test:smoke`, and `npm.cmd run test:acceptance` remain intact. The intentionally failing original acceptance suite continues to describe the original marketplace.

## Data and trust boundaries

- `control/web/`: companion dashboard, separate from marketplace `src/`.
- `control/*.ts`: controller API, approval state machine, snapshot handling, runner, and result processing.
- `control/private/`: local engineer credential; gitignored, never copied.
- `control/data/local/controller.sqlite`: imported complaints, proposals, approvals, runs, activity.
- `control/data/local/snapshots/`: frozen baseline and developer-authored candidate snapshots.
- `control/data/local/workspaces/`: disposable per-run baseline/candidate applications and test data.
- `control/data/local/runs/`: logs, observations, screenshots/traces, and structured results.
- `control/data/controller-tests/`: independent controller-test databases, credentials, snapshots, workspaces, and evidence.
- `verification/control-discount.spec.ts` and `discount-contract.ts`: trusted discount checks and requirement identifiers.

Application copies follow the existing handoff allowlist: `src/`, `server/`, `public/`, package files, tsconfig, Vite config, index.html, .gitignore, and `INVESTIGATOR_SETUP.md` renamed to README.md. The main README, `operator/`, previous reports, controller files, test harness, and private credentials are excluded. The fixture-authoring recipe in `control/snapshots.ts` stays outside the copied application.

**Separate folders and browser sessions are not a security sandbox.** This original host runner still executes only reviewed developer-authored fixtures. Agent-generated proposals have a separate Docker isolation gate and runner; they cannot enter this host execution path. See [the milestone-3 execution boundary](AGENT-1.md#isolation-design-and-limits). No arbitrary upload/patch-execution feature is provided.

The marketplace's Vite configuration denies requests for `control/`, `operator/`, `verification/`, and `data/`, in addition to its usual sensitive-file exclusions. This keeps controller credentials and private notes from being exposed by the development file server. The watcher also ignores controller files. Marketplace addresses, commands, and application behavior are unchanged.

Keep the controller's database, private directory, and evidence out of the future investigator's editable workspace. The existing `operator/WORKFLOW.md` human merge decision remains reserved for a later milestone.
