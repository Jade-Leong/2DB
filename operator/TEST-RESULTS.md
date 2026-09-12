# Build and verification — 2026-09-12

Environment: Windows PowerShell, Node.js 24.13.0, npm 11.6.2, Playwright Chromium (browser build 1243).

| Check | Actual result |
| --- | --- |
| Dependency installation / audit | Passed; 0 known vulnerabilities reported |
| TypeScript + Vite production build | Passed |
| Smoke suite | 9 passed, 0 failed |
| Acceptance suite | 1 passed, 4 failed |
| Combined suite | 10 passed, 4 failed; exit code 1 |

The four failing tests are the intended defects, with two independent discount cases:

1. Discounted knit checkout: displayed/order total $38.40; payment recorded $48.00. Equality assertions fail in both UI receipt and HTTP detail response.
2. Mixed eligibility and quantities: correct final total 14,180 cents; payment is 16,100 cents.
3. Order history: the newly paid order link is absent and the history API omits its ID. The direct receipt, purchased items, stable payment ID, and denial to another buyer pass.
4. Photo persistence: the immediate upload URL is served and visible. After refresh, a fresh seller session, and buyer viewing, the URL reverts to `/images/knit.png`. All three persistence assertions fail. Other-seller upload denial passes.

The invalid-code acceptance check passes. No tests were skipped, assertions inverted, or failures reclassified as successes.

Passing smoke coverage: product browsing/filter/search and image loading; undiscounted browser checkout and quantity changes; persisted SQLite order/payment and retry deduplication; server identity/ownership restrictions; server-controlled prices and invalid carts; listing creation/edit persistence; valid upload serving plus malformed/oversized file rejection; support-ticket database persistence; mobile viewport fit.

An initial attempt could not launch UI tests because the installed Playwright package required a different Chromium build. After installing its matching browser, the complete suite ran. The first upload fixture was malformed and rejected by the image decoder; it was replaced with a valid PNG. Neither setup failure is counted as an intentional application defect. Vite's initial sandbox path-access failure was resolved by running the build outside the sandbox.

Final visual review uses `screenshots/home-desktop.png` and `screenshots/home-mobile.png`. Payment-failure screenshots and full traces are retained by Playwright in the root `test-results/` directory; the HTML report is in `playwright-report/`. These artifacts are private operator evidence, not investigator handoff material.

Final combined suite completed in 56.3 seconds. After that run, fonts were changed from a remote stylesheet to local Fontsource packages; the production build was rerun successfully. The running development site was then captured at 1440px and 390px widths: no page/console errors and no horizontal overflow. The behavioral suite was not repeated for this font-only change. Manual `npm.cmd run reset` succeeded and the development server was started with fresh local seed data at http://127.0.0.1:5173.
# Later milestones

The original marketplace results below are preserved. See [milestone 2](MILESTONE-2-RESULTS.md) for the engineer dashboard and [milestone 3](MILESTONE-3-RESULTS.md) for Agent 1 integration, automated checks, and explicit live-run setup blockers.
