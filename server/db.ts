import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const dataDir = path.join(
  root,
  process.env.LOOP_TEST === "1" ? "data/test" : "data/local",
);
export const uploadsDir = path.join(dataDir, "uploads");
mkdirSync(uploadsDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "market.sqlite"));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('buyer','seller')), shop TEXT);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES accounts(id), title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents>0), photo_url TEXT, eligible INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS discounts(code TEXT PRIMARY KEY, percent INTEGER NOT NULL, active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES accounts(id), status TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, discount_code TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id), title TEXT NOT NULL, quantity INTEGER NOT NULL, unit_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), amount_cents INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS support_tickets(id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), subject TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkout_requests(buyer_id TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id), PRIMARY KEY(buyer_id,request_key));`);

export function seed() {
  if (db.prepare("SELECT id FROM accounts LIMIT 1").get()) return;
  db.exec("BEGIN");
  try {
    const account = db.prepare("INSERT INTO accounts VALUES (?,?,?,?)");
    account.run("buyer-maya", "Maya Chen", "buyer", null);
    account.run("buyer-jamie", "Jamie Rivera", "buyer", null);
    account.run("seller-olive", "Olive Brooks", "seller", "Olive & Co.");
    account.run("seller-theo", "Theo Park", "seller", "The Sunday Shelf");
    const insert = db.prepare("INSERT INTO products VALUES (?,?,?,?,?,?,?,?)");
    const products = [
      [
        "p-knit",
        "seller-olive",
        "The everyday knit",
        "A soft, oat-colored cotton knit for slow mornings and everything after. Relaxed fit, size M. Gently loved and ready for its next chapter.",
        "Clothing",
        4800,
        "knit",
        1,
      ],
      [
        "p-vase",
        "seller-olive",
        "A little sunshine vase",
        "Warm amber glass with a playful rounded silhouette. Beautiful with a single stem or all on its own. 18 cm tall.",
        "Home",
        3200,
        "vase",
        1,
      ],
      [
        "p-book",
        "seller-theo",
        "Notes from the garden",
        "An illustrated collection of small gardens and big ideas. Hardcover, excellent condition. A thoughtful companion for a quiet afternoon.",
        "Books",
        2400,
        "book",
        1,
      ],
      [
        "p-tote",
        "seller-olive",
        "Out-and-about tote",
        "Sturdy sage canvas with roomy handles and an inside pocket. Your new everyday carry, from market mornings to library afternoons.",
        "Clothing",
        1800,
        "tote",
        1,
      ],
      [
        "p-lamp",
        "seller-theo",
        "The reading corner lamp",
        "A sculptural coral table lamp with a warm glow. Tested and working. Includes an LED bulb; local demo delivery is always free.",
        "Home",
        6500,
        "lamp",
        0,
      ],
      [
        "p-bowls",
        "seller-theo",
        "Sunday ceramic bowls",
        "A pair of speckled stoneware bowls in soft blue. Made for soup, cereal, or whatever the day brings. Excellent condition.",
        "Home",
        3600,
        "bowls",
        1,
      ],
    ];
    for (const p of products)
      insert.run(...p.slice(0, 6), `/images/${p[6]}.png`, p[7]);
    db.prepare("INSERT INTO discounts VALUES (?,?,?)").run("LOOP20", 20, 1);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
seed();
