# Hosted deployment readiness

## Current status — September 12, 2026

Hosting is **incomplete**. Marketplace preview: https://twodb-steel.vercel.app/; dashboard preview: https://twodb-steel.vercel.app/control/. Both public pages returned HTTP 200, but the public API health check returned HTTP 503. Seven direct sandbox checks passed, including a purchase retaining the intentional discount mismatch, buyer isolation, engineer authentication, and persistence after restart. Those direct checks do not prove the public API works.

The temporary hosted backend uses a Vercel persistent Sandbox and Drive with separate hosted SQLite data. Local customer data is preserved. Live Agent 1 has not completed a successful investigation.

### Supabase handoff

Fetched GitHub origin/main at `88ed481` and inspected it in a separate detached checkout at `deployment/data/supabase-source`, preserving local work. The handoff prepares private schema `two_db` in project `jcynpdtvuqrppkkgegbt`; it leaves the application using SQLite and does not configure Supabase Storage or Auth.

The other engineer will privately configure the Sensitive Vercel Production variable `SUPABASE_DB_URL` with the Session pooler URI. Never put its password or URI in Git, chat, tickets, or logs. Application database, storage, and engineer sign-in integration still needs implementation and validation after that configuration.

### Deploy on commit — not enabled yet

The authenticated CLI attempt to connect `https://github.com/Jade-Leong/2DB.git` failed because Vercel could not connect to the repository. Open https://vercel.com/jade-leongs-projects/twodb/settings/git and connect that repository. If it is absent, configure the Vercel GitHub App's repository access. The account owner must complete any required account authorization.

The hosting files are currently local and uncommitted. The GitHub tree does not yet have the hosted build configuration, and Vercel's current Root Directory is `.`. Before declaring automatic deployment ready, commit the reviewed hosting configuration, configure matching build/root settings and asset generation, and verify a push-triggered deployment. The sandbox backend also needs to update to the same source revision; a static deployment alone does not update it.

Use `main` as the production branch. Vercel Git integration deploys pushed commits, not local-only commits: https://vercel.com/docs/git. No push or real proposal approval was performed in this setup step.

Existing root README and `control/AGENT-1.md` retain the local startup instructions. Deployment helpers live in `deployment/vercel/`; `.env.local`, `.vercel/`, and `data/` contain private configuration and must not be printed or committed.

## Historical pre-deployment assessment

The notes below describe the initial assessment, before the preview deployment above.

Status: **not deployed**. Both Loop Market and the 2DB dashboard/worker were requested for hosting. This directory records deployment work separately from the preserved local application.

## Verified September 12, 2026

- Vercel CLI 59.15.1 authenticates successfully. No existing Vercel project is named 2DB or Loop Market. Existing unrelated projects have not been modified.
- Loop Market binds to loopback port 3001 and writes SQLite and uploads under `data/local/`.
- The controller binds to loopback port 3002, explicitly rejects non-loopback Host/Origin headers, writes its own SQLite database, and keeps engineer sessions in memory.
- Investigations and verification execute background work and invoke a local Docker daemon. Copying the frontend to Vercel would not deploy these capabilities.
- No local customer database, engineer credential, API key, investigation evidence, operator report, or Git history has been uploaded.
- Live Agent 1 remains unresolved. The latest live attempt returned HTTP 200 but failed with `sdk_transport`. The isolated synthetic streaming check passes, including split UTF-8 and SSE chunks; this is not a live model success.

## Hosting decision required

1. **Vercel frontends plus a separate persistent backend server:** preserves SQLite and the Docker architecture with fewer changes. Requires a separate hosting account/server, budget, HTTPS routing and hosted engineer access. A private controller-to-worker boundary remains mandatory.
2. **All services on Vercel:** requires persistent external application state and uploads, hosted authentication/session storage, durable investigation job execution, and a Vercel Sandbox execution adapter. Container Functions alone do not provide the existing durable local filesystem or local Docker daemon contract. This is a migration, not a static-site upload.

References:

- https://vercel.com/kb/guide/is-sqlite-supported-in-vercel
- https://vercel.com/kb/guide/docker
- https://vercel.com/docs/sandbox/concepts/persistent-sandboxes

The local source defects, saved data, exact-revision approval rules and trusted-test separation must survive either choice. Hosted accounts/credentials must be separate from the existing local engineer key and the worker key currently held in the user's PowerShell process. Do not copy secret files or dump environment variables to configure hosting.

## Release checks before reporting deployment complete

- Purchase, ticket import, engineer login and exact-revision approval work over the actual HTTPS addresses.
- Application state and evidence survive service restarts.
- Candidate execution passes isolation checks and cannot access engineer/API credentials or protected controller/harness data.
- Trusted baseline and fixed-fixture verification produce the expected failing/passing discount results.
- A live investigation result is reported honestly; no fixture replaces model output.
- Public static paths cannot serve source, credentials, SQLite files, reports or private fixtures.
- No proposal is approved, merged or deployed by an investigator.

Do not deploy the repository root using an unrestricted upload or expose the current loopback controller with a public tunnel as a substitute for this migration.
