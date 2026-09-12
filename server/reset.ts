import { rmSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { db, seed, uploadsDir, root } from "./db.js";

const target = realpathSync(uploadsDir);
const relative = path.relative(realpathSync(root), target).replaceAll('\\', '/');
if (!['data/local/uploads', 'data/test/uploads'].includes(relative)) {
  db.close();
  throw new Error('Reset refused: upload directory resolves outside disposable project data.');
}
db.exec(
  "BEGIN; DELETE FROM checkout_requests; DELETE FROM payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM support_tickets; DELETE FROM products; DELETE FROM discounts; DELETE FROM accounts; COMMIT;",
);
rmSync(target, { recursive: true, force: true });
mkdirSync(uploadsDir, { recursive: true });
seed();
db.close();
console.log(
  "Loop Market demo reset. Seed accounts and listings restored; local orders, payments, tickets, and uploads cleared.",
);
