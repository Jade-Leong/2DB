# Private builder notes — exclude from investigator context

These are three intentionally localized defects. There is no runtime broken/fixed switch, no repair button, and no fake failure response. Do not copy this directory or the builder conversation into an investigator workspace.

## Payment discount mismatch

In `server/index.ts`, the checkout route computes a server quote correctly and writes its discounted `total_cents` to the order. Its payment INSERT uses `q.subtotal_cents`. This genuine divergence records 4,800 cents for a 3,840-cent discounted order. The browser obtains its quote from the server; browser-submitted totals do not control either amount.

Desired invariant: payment amount equals the canonical discounted order total. Apply discounts once, only to eligible line values; respect quantities, invalid codes, and integer rounding. The mixed-cart acceptance case deliberately tests two knits plus the ineligible lamp: subtotal 16,100 cents, discount 1,920, final 14,180. Current payment is 16,100.

## Missing paid order history

In `server/index.ts`, GET `/api/orders` filters statuses to `shipped` and `delivered`. Checkout writes the real status `paid`. Order detail uses buyer ownership without that status filter, so the saved order remains readable directly by its buyer. Payment and order creation are not broken.

Desired invariant: include newly paid orders for the owning buyer without creating another order or payment. Maintain buyer isolation. The no-discount history acceptance case isolates this defect from the payment mismatch.

## Photo association does not persist

In `server/index.ts`, POST `/api/listings/:id/photo` validates ownership and file type, decodes and re-encodes the image, writes it under a generated filename, and returns a product with the new URL. It does not write that URL to the product row. The React seller view updates immediately from that response. A refresh reads the unchanged SQLite association, restoring the old image or placeholder. The uploaded file really exists; it becomes an orphan until reset.

Desired invariant: the listing association persists, and both a new seller session and buyer detail page receive the saved URL. Other sellers cannot update it. Keep MIME/signature/decoder validation, size limits, generated filenames, and ownership checks.

## Other boundaries

The demo selector is intentionally not real authentication; a user can select any seeded account. Protected operations look up the chosen account and enforce role/ownership in SQL. This is the explicitly requested local-only demo identity model. No production authentication, financial integration, external communications, or agent orchestration exists.

The checkout retry key is scoped to buyer and stored in SQLite. Order and payment insertion are transactional. A browser retry after a lost response reuses its pending key, preventing duplicate simulated payments. Tests verify the same key returns the same order/payment.
