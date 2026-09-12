# Independent verification

Run from the project root after `npm.cmd run build`. Install Chromium with `npx.cmd playwright install chromium` once. Stop the manual app first.

- `npm.cmd run test:smoke`: working capabilities and safety boundaries.
- `npm.cmd run test:acceptance`: intended customer behavior. Failures remain failures.
- `npm.cmd test`: both projects, one HTML report.

All tests run serially with a reset before each scenario and a fresh browser context. `helpers.ts` invokes the existing reset CLI against `data/test/`; it never imports the application's pricing, order filtering, or photo implementation. Acceptance assertions use only browser/HTTP-observable outputs. Smoke checks additionally inspect SQLite records to verify actual persistence and payment cardinality.

`fixtures/seller-photo.png` is a valid local PNG under 2 MB, suitable for manual upload reproduction too. Soft assertions are used only to collect multiple requirement failures in a single scenario. No assertions are inverted and no known failures are skipped or marked expected.

Keep this suite independent of proposed implementation fixes. After a fix, rerun the unchanged requirement checks, especially ownership, quantity/eligibility, and payment idempotency.
