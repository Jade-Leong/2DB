# Supabase for 2DB

The database schema has been deployed to project `jcynpdtvuqrppkkgegbt` through the authenticated Supabase MCP connection. The project URL is configured in `.env`. The local application connection has been configured privately with verified TLS.

## Connect

1. Open your Supabase project's **Connect** panel and choose **Session pooler**.
2. Copy the PostgreSQL URI into `SUPABASE_DB_URL` in this project's `.env`. Replace the password placeholder with your database password; percent-encode special characters in that password. Keep this value server-only, with no `VITE_` prefix.
3. Use Node.js 24 or newer and run `npm run supabase:check`.
4. Run `npm run supabase:setup` to apply any pending migrations. The initial migration is already applied and recorded with its checksum, so it will be skipped.

The connection uses TLS with certificate verification. If your endpoint requires the Supabase root certificate, download it from the project's database settings and set `SUPABASE_DB_CA_FILE` to its file path in `.env`. Do not disable certificate verification.

Setup applies versioned SQL migrations in one transaction, records checksums, and skips migrations already applied. It creates the eight marketplace tables in the private `two_db` schema with row-level security enabled and no browser role access. It does not alter unrelated schemas or copy local customer records.

## Current integration status

Remote verification on September 12, 2026 confirmed all eight application tables plus the migration ledger exist, all have RLS enabled, and neither `anon` nor `authenticated` can access the schema. A rolled-back transaction inserted two identical complaints and verified they produce the same joined customer/complaint input. No test rows remain. This is a database smoke check, not an end-to-end app-to-Supabase test.

Supabase advisors reported only informational notices: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), which intentionally denies browser access for these server-only tables, and [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), expected before application traffic. There were no warning or error findings.

The marketplace uses Supabase when `MARKET_DATABASE=supabase`. Accounts, products, discounts, orders, items, payments, checkout retry records, and complaints share the private `two_db` schema. Both intake choices submit through the same `/api/support` endpoint. The controller reads its inbox from Supabase in read-only transactions and freezes the same original complaint before investigation.

Investigation records, approvals, evidence, and uploaded files remain local to this machine. Demo account selection remains the existing local-only identity mechanism; Supabase Auth is not enabled. This switch is database persistence, not a public production deployment.

## Cutover and rollback

1. Stop the marketplace and controller to prevent writes during migration.
2. Configure `SUPABASE_DB_URL` and optionally `SUPABASE_DB_CA_FILE`; run `npm run supabase:setup`.
3. Run `npm run supabase:import` once. This copies the local marketplace with row-content verification in a single transaction. It refuses a nonempty destination and preserves the original SQLite file.
4. Set `MARKET_DATABASE=supabase` in `.env` and restart `npm start` and `npm run control`.

The September 12 cutover copied 4 accounts, 6 products, and 1 discount. There were no orders or complaints in the local database. Do not repeat the import after accepting new Supabase writes. Reverting to `MARKET_DATABASE=sqlite` requires a deliberate data reconciliation: the retained local file does not contain new Supabase submissions.

Automated tests always set `LOOP_TEST=1`, which disables remote connections and uses disposable SQLite. `npm run reset` resets only SQLite. To run the explicit live integration check against the running marketplace, use `SUPABASE_LIVE_CHECK=1 npm run supabase:test`; it creates and removes its own test records. This check covers listings, concurrent checkout retries, complaint storage, authenticated controller inbox, and investigation dispatch without calling a paid model.

Connection guide: https://supabase.com/docs/guides/database/connecting-to-postgres

## Verification after switching

Build and controller type checks passed. The support suite (13), marketplace smoke suite (9), agent suite (12), controller suite (11), and Tavily suite (7) passed: 52 checks total. The explicit Supabase check also passed, including concurrent checkout retries and authenticated investigation dispatch for identical complaints. Transaction rollback was checked separately. Live voice audio and a paid investigation model were not invoked. Temporary verification records were removed.
