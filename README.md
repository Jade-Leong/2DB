# Loop Market

A fictional local shopping marketplace for **2DB — Two agents. One reproducible bug.**

The customer website preserves three intentional application defects for investigation. All purchases and funds are simulated; no real payment information is requested. Milestone 2 adds a separate local engineer review application under `control/`. Milestone 3 adds a Codex SDK Agent 1 integration gated by worker authentication and actual Linux-container isolation. Live Agent 2, GitHub PR integration, merging, and deployment remain unimplemented.

## Milestone 3: Agent 1 investigation

See [the Agent 1 operating guide](control/AGENT-1.md) for Docker Desktop setup, private API-key configuration, exact PowerShell commands, ticket investigation, evidence, and human approval. The dashboard remains at http://127.0.0.1:3002. It shows **Setup required** until authentication and the container/browser probe pass. A live model run has not yet been demonstrated; [actual results](operator/MILESTONE-3-RESULTS.md) distinguish deterministic tests from live execution. Original marketplace source and saved data are preserved.

## Milestone 2: 2DB engineer review

The companion dashboard runs separately at **http://127.0.0.1:3002** with `npm.cmd run control`. Open a separate PowerShell window and run `npm.cmd run control:engineer` to obtain the local engineer-session key. It imports actual support tickets read-only, displays developer-authored local change proposals, requires exact-revision approval, and runs trusted baseline-versus-candidate Playwright verification. Stop Loop Market with Ctrl+C before verification uses port 3001; leave 2DB running. The controller never resets or patches the original marketplace.

See [the full controller guide](control/README.md) for setup, ticket import, approval, evidence, tests, and trust boundaries. The original marketplace startup and reproduction instructions below are preserved.

## Start on Windows PowerShell

Requires Node.js 24 or newer. Use `npm.cmd` and `npx.cmd` to avoid PowerShell's `npm.ps1` execution-policy restriction.

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
node --version
npm.cmd ci
npm.cmd run reset
npm.cmd run dev
```

Leave this PowerShell window running. Open **http://127.0.0.1:5173**. Press **Ctrl+C** to stop both the frontend and API.

If dependencies are already installed, only `npm.cmd run dev` is needed. The app seeds itself when the database is first created. Internet access is needed to install packages and the test browser. Product images and fonts are bundled locally; browsing and simulated purchases need no external services.

To run the production build locally instead:

```powershell
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:3001** for this mode. Do not run production mode and development mode together; both use API port 3001. If the port is occupied, stop the earlier Loop Market terminal with Ctrl+C. The server listens on loopback only.

## Select a demo account

Use **Local-only demo account** beneath the navigation. No password is needed.

| Account | Role | Use |
| --- | --- | --- |
| Maya Chen | Buyer | Shop, checkout, view own orders, submit complaints |
| Jamie Rivera | Buyer | Separate buyer with separate orders and bag |
| Olive Brooks | Seller | Manage Olive & Co. listings |
| Theo Park | Seller | Manage The Sunday Shelf listings |

Choose a buyer before using the bag and checkout. Choose a seller, then **Sell with us**, to create/edit listings and upload photos. **Support** saves a complaint in SQLite and returns a reference; it does not contact anyone.

The explicit demo selector sends a local account ID. The server resolves that ID in SQLite and enforces roles and ownership on every protected operation. Anyone using this local demo can deliberately select another seeded identity. This is demo impersonation, not password authentication or production sign-in.

## Reproduce the three complaints

Reset between scenarios using the instructions below. Use a new InPrivate/Incognito window for each scenario so the previous bag and account selection do not carry over.

### 1. “I used a discount code, but I was charged the full price.”

1. Select **Maya Chen · buyer**.
2. Open **The everyday knit** ($48.00), then **Add to bag**.
3. Open **Bag**, then **Continue to checkout**.
4. Enter **LOOP20** in the discount-code field. Wait for the displayed total to become **$38.40**.
5. Select **Place simulated order**.
6. The receipt shows an order total of **$38.40** but a simulated payment of **$48.00**. Both are actual records in SQLite.

LOOP20 gives 20% off eligible lines, rounded down to whole cents across the eligible subtotal. The reading corner lamp is excluded. There are no shipping fees or taxes. Invalid codes do not reduce totals.

### 2. “My payment went through, but my order isn't showing up.”

1. Reset and select **Maya Chen · buyer**.
2. Buy **The everyday knit** without a discount to isolate this scenario.
3. The receipt shows a paid order and a successful **$48.00** simulated payment. Copy its browser URL or order reference.
4. Select **View order history**, then refresh. The order is absent.
5. Open the saved receipt URL as Maya: the order still exists. Select Jamie and open that same URL: access is denied.

### 3. “I uploaded a product photo, but it disappeared.”

1. Reset and select **Olive Brooks · seller**.
2. Open **Sell with us**. Under **The everyday knit**, use **Upload photo**.
3. Choose `verification\fixtures\seller-photo.png` in this project, or another valid PNG/JPEG under 2 MB and 12 megapixels.
4. The new photo appears immediately.
5. Refresh the page. The original listing photo returns. For a newly created listing with no original image, the placeholder returns.
6. Switching to a buyer also shows the original saved listing image.

## Run checks

Stop the running app with Ctrl+C first. Tests use port 3001 and intentionally refuse to reuse a running server. Build again after frontend edits; these browser tests exercise the built site.

```powershell
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:smoke
npm.cmd run test:acceptance
```

Or run both suites in one report:

```powershell
npm.cmd test
npx.cmd playwright show-report
```

Smoke tests are separate from acceptance tests. Acceptance assertions describe correct behavior and are expected to expose the defects with a nonzero exit code. No tests are skipped, inverted, retried to hide failures, or marked as expected failures. Soft assertions in acceptance tests let independent requirements be checked after the first mismatch; the test still fails.

Each test resets `data/test/` before its scenario, runs serially, and starts with a fresh browser context. Test data is separate from `data/local/`; a test run does not erase your manual demo purchases. The HTML report, failure screenshots, and Playwright traces appear in `playwright-report/` and `test-results/`. Reports may reveal investigation results; do not hand them to future investigator agents.

## Safe reset

Close the demo's InPrivate/Incognito windows and stop the app with Ctrl+C. Then run:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
npm.cmd run reset
npm.cmd run dev
```

Open a fresh InPrivate/Incognito window at **http://127.0.0.1:5173**. A normal browser window retains its bag in localStorage: remove bag items manually if you prefer to reuse it. Development and production addresses also have separate browser storage.

Reset clears only Loop Market's local database rows and its disposable `data/local/uploads/` directory, then restores the four accounts and six products. It never removes source code, seed photos, dependencies, or sibling folders. Order, payment, and ticket IDs are newly generated on purchase/submission; seed account and product IDs remain stable. Use reset only when Loop Market is stopped. Tests set `LOOP_TEST=1` internally; do not set that variable for manual demo sessions.

## Project boundaries

- `src/`: React + TypeScript UI and styling.
- `server/`: Express, server-owned pricing, SQLite schema/seed, and safe reset.
- `public/images/`: six original, locally stored AI-generated fictional product photos.
- `data/local/`: manual demo SQLite database and uploads, disposable and gitignored.
- `data/test/`: isolated automated-test database and uploads, disposable and gitignored.
- `verification/`: independent acceptance and smoke checks. Acceptance tests call the UI/HTTP API and do not import application implementation.
- `operator/`: private defect notes, build/test results, visual QA, asset prompts, and future workflow design. Not served by the application.

The server stores integer cents, snapshots item titles/prices at purchase time, uses a transaction for each order/payment pair, and deduplicates retries by buyer and checkout request key. It never trusts submitted prices or payment amounts. Uploads are size limited, decoded, re-encoded without metadata, randomly named, and stored beneath disposable project data. Seller ownership is checked before upload processing.

## Future investigation handoff

Do not give future investigator agents this conversation, `operator/`, test reports, or the builder's answer key. Use a fresh, restricted workspace containing only `src/`, `server/`, `public/`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, and `INVESTIGATOR_SETUP.md`. Rename the latter to `README.md` there. Do not copy this operator-oriented README. Give Agent 1 only the selected customer complaint and intended behavior. The independent acceptance suite stays under the operator's control for Agent 2's sandbox verification.

The 2DB human approval boundaries are recorded privately under `operator/WORKFLOW.md`. Milestone 2 implements local engineer approval and scripted verification in `control/`; Agent 1 is now implemented behind the milestone-3 setup/isolation gate; live Agent 2 and GitHub PR integration remain unimplemented.
