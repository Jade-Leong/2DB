import express from "express";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { db, uploadsDir, root } from "./db.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use("/uploads", express.static(uploadsDir, { dotfiles: "deny" }));
type Account = { id: string; name: string; role: string; shop: string | null };
type Product = {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  photo_url: string | null;
  eligible: number;
};
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function identity(req: express.Request, role?: string): Account {
  const id = req.header("X-Demo-Account");
  const user = db.prepare("SELECT * FROM accounts WHERE id=?").get(id ?? "") as
    Account | undefined;
  if (!user) return fail("Select a local demo account.", 401);
  if (role && user.role !== role)
    return fail(`This action requires a ${role} account.`, 403);
  return user;
}
const productQuery = `SELECT p.*, a.name AS seller_name, a.shop FROM products p JOIN accounts a ON a.id=p.seller_id`;
function quote(body: any) {
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 30
  )
    fail("Add between 1 and 30 different items.");
  const seen = new Set<string>();
  const items = body.items.map((item: any) => {
    if (
      typeof item.productId !== "string" ||
      seen.has(item.productId) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10
    )
      fail("Invalid cart quantity or duplicate item.");
    seen.add(item.productId);
    const product = db
      .prepare("SELECT * FROM products WHERE id=?")
      .get(item.productId) as Product | undefined;
    if (!product) return fail("An item is no longer available.");
    return { ...product, quantity: item.quantity as number };
  }) as (Product & { quantity: number })[];
  const code =
    typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const discount = db
    .prepare("SELECT percent FROM discounts WHERE code=? AND active=1")
    .get(code) as { percent: number } | undefined;
  const subtotal_cents = items.reduce(
    (n, p) => n + p.price_cents * p.quantity,
    0,
  );
  const eligible = items.reduce(
    (n, p) => n + (p.eligible ? p.price_cents * p.quantity : 0),
    0,
  );
  const discount_cents = discount
    ? Math.floor((eligible * discount.percent) / 100)
    : 0;
  return {
    items,
    subtotal_cents,
    discount_cents,
    total_cents: subtotal_cents - discount_cents,
    code: discount ? code : null,
    code_valid: !!discount,
  };
}
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/accounts", (_req, res) =>
  res.json(db.prepare("SELECT * FROM accounts").all()),
);
app.get("/api/products", (_req, res) =>
  res.json(db.prepare(productQuery).all()),
);
app.get("/api/products/:id", (req, res) => {
  const p = db
    .prepare(`${productQuery} WHERE p.id=?`)
    .get(String(req.params.id));
  if (!p) fail("Listing not found.", 404);
  res.json(p);
});
app.post("/api/quote", (req, res) => {
  identity(req, "buyer");
  res.json(quote(req.body));
});
function orderDetail(id: string, buyerId: string) {
  const order = db
    .prepare("SELECT * FROM orders WHERE id=? AND buyer_id=?")
    .get(id, buyerId);
  if (!order) return fail("Order not found.", 404);
  return {
    ...order,
    items: db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id),
    payment: db.prepare("SELECT * FROM payments WHERE order_id=?").get(id),
  };
}
app.post("/api/checkout", (req, res) => {
  const user = identity(req, "buyer");
  const key = req.body.requestKey;
  if (typeof key !== "string" || key.length < 8 || key.length > 100)
    fail("A checkout request key is required.");
  const previous = db
    .prepare(
      "SELECT order_id FROM checkout_requests WHERE buyer_id=? AND request_key=?",
    )
    .get(user.id, key) as { order_id: string } | undefined;
  if (previous) {
    res.json(orderDetail(previous.order_id, user.id));
    return;
  }
  const q = quote(req.body),
    id = randomUUID(),
    now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      user.id,
      "paid",
      q.subtotal_cents,
      q.discount_cents,
      q.total_cents,
      q.code,
      now,
    );
    const insert = db.prepare(
      "INSERT INTO order_items(order_id,product_id,title,quantity,unit_cents) VALUES(?,?,?,?,?)",
    );
    for (const p of q.items)
      insert.run(id, p.id, p.title, p.quantity, p.price_cents);
    db.prepare("INSERT INTO payments VALUES (?,?,?,?,?)").run(
      randomUUID(),
      id,
      q.subtotal_cents,
      "succeeded",
      now,
    );
    db.prepare("INSERT INTO checkout_requests VALUES (?,?,?)").run(
      user.id,
      key,
      id,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.status(201).json(orderDetail(id, user.id));
});
app.get("/api/orders", (req, res) => {
  const user = identity(req, "buyer");
  res.json(
    db
      .prepare(
        "SELECT * FROM orders WHERE buyer_id=? AND status IN ('shipped','delivered') ORDER BY created_at DESC",
      )
      .all(user.id),
  );
});
app.get("/api/orders/:id", (req, res) =>
  res.json(orderDetail(String(req.params.id), identity(req, "buyer").id)),
);
app.get("/api/listings", (req, res) =>
  res.json(
    db
      .prepare(`${productQuery} WHERE p.seller_id=?`)
      .all(identity(req, "seller").id),
  ),
);
function owned(req: express.Request) {
  const user = identity(req, "seller");
  const p = db
    .prepare("SELECT * FROM products WHERE id=? AND seller_id=?")
    .get(String(req.params.id), user.id) as Product | undefined;
  if (!p) return fail("Listing not found.", 404);
  return p;
}
function listing(body: any) {
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > 100 ||
    typeof body.description !== "string" ||
    !body.description.trim() ||
    body.description.length > 2000
  )
    fail("Enter a title and description within the length limits.");
  if (
    !["Clothing", "Books", "Home"].includes(body.category) ||
    !Number.isInteger(body.price_cents) ||
    body.price_cents < 1 ||
    body.price_cents > 1000000
  )
    fail("Choose a category and a price from $0.01 to $10,000.");
  return [
    body.title.trim(),
    body.description.trim(),
    body.category,
    body.price_cents,
  ] as const;
}
app.post("/api/listings", (req, res) => {
  const u = identity(req, "seller"),
    values = listing(req.body),
    id = randomUUID();
  db.prepare("INSERT INTO products VALUES(?,?,?,?,?,?,?,?)").run(
    id,
    u.id,
    ...values,
    null,
    1,
  );
  res.status(201).json(db.prepare(`${productQuery} WHERE p.id=?`).get(id));
});
app.put("/api/listings/:id", (req, res) => {
  const p = owned(req),
    values = listing(req.body);
  db.prepare(
    "UPDATE products SET title=?,description=?,category=?,price_cents=? WHERE id=? AND seller_id=?",
  ).run(...values, p.id, p.seller_id);
  res.json(db.prepare(`${productQuery} WHERE p.id=?`).get(p.id));
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
});
app.post(
  "/api/listings/:id/photo",
  (req, res, next) => {
    try {
      owned(req);
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single("photo"),
  async (req, res) => {
    const p = owned(req),
      file = req.file;
    if (!file) return fail("Choose a PNG or JPEG file.");
    const png = file.buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg =
      file.buffer[0] === 255 &&
      file.buffer[1] === 216 &&
      file.buffer[2] === 255;
    if (
      !(png && file.mimetype === "image/png") &&
      !(jpg && file.mimetype === "image/jpeg")
    )
      fail("Only PNG or JPEG images up to 2 MB are accepted.");
    let clean: Buffer;
    try {
      const decoder = sharp(file.buffer, {
        limitInputPixels: 12000000,
        failOn: "warning",
      });
      const meta = await decoder.metadata();
      if (!["png", "jpeg"].includes(meta.format ?? ""))
        return fail("Choose a valid PNG or JPEG.");
      clean = await (
        png ? decoder.png() : decoder.jpeg({ quality: 90 })
      ).toBuffer();
    } catch {
      return fail(
        "This image could not be read. Use a valid PNG or JPEG under 12 megapixels.",
      );
    }
    const name = `${randomUUID()}.${png ? "png" : "jpg"}`;
    writeFileSync(path.join(uploadsDir, name), clean, { flag: "wx" });
    res.json({ ...p, photo_url: `/uploads/${name}` });
  },
);
app.post("/api/support", (req, res) => {
  const u = identity(req);
  const { subject, message } = req.body;
  if (
    typeof subject !== "string" ||
    !subject.trim() ||
    subject.length > 150 ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 5000
  )
    fail("Enter a subject and message within the length limits.");
  const id = randomUUID();
  db.prepare("INSERT INTO support_tickets VALUES (?,?,?,?,?)").run(
    id,
    u.id,
    subject.trim(),
    message.trim(),
    new Date().toISOString(),
  );
  res.status(201).json({ id });
});
app.use(express.static(path.join(root, "dist")));
app.get("/{*path}", (req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.sendFile(path.join(root, "dist/index.html"));
});
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      err instanceof multer.MulterError ? 400 : (err.status ?? 500);
    if (status === 500) console.error(err);
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "Something went wrong. Please try again."
            : err instanceof multer.MulterError
              ? "Upload one PNG or JPEG up to 2 MB."
              : err.message,
      });
  },
);
app.listen(3001, "127.0.0.1", () =>
  console.log(
    "Loop Market API: http://127.0.0.1:3001 (local demo identities only)",
  ),
);
