# Supabase for 2DB

The database schema has been deployed to project `jcynpdtvuqrppkkgegbt` through the authenticated Supabase MCP connection. The project URL is configured in `.env`. The application's database password and Session pooler connection URI still need to be supplied privately.

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

These tools prepare and check the Supabase database. The running marketplace still uses SQLite, and the investigator still imports tickets from that SQLite file. Switching live persistence requires updating both of those paths together, preserving checkout transactions and isolating automated tests from the remote database. Uploaded photos also remain local. Supabase authentication and storage are not configured by this setup.

Connection guide: https://supabase.com/docs/guides/database/connecting-to-postgres
