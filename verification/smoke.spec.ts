import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  reset,
  buyer,
  otherBuyer,
  seller,
  otherSeller,
  purchase,
  photo,
  selectAccount,
  bagToCheckout,
} from "./helpers";
test.beforeEach(() => reset());
test("browse, filter, search, and load real product images", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good things. Another go." }),
  ).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(6);
  await page.getByRole("button", { name: "Books", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.getByRole("button", { name: "All finds", exact: true }).click();
  await page.getByLabel("Search products").fill("vase");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.locator(".product-image").click();
  await expect(
    page.getByRole("heading", { name: "A little sunshine vase" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".detail-photo")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
});
test("purchase without discount persists one order and payment; retry is idempotent", async ({
  request,
}) => {
  const key = crypto.randomUUID();
  const order = await purchase(request, "", { requestKey: key });
  expect(order.total_cents).toBe(4800);
  expect(order.payment.amount_cents).toBe(4800);
  expect(order.status).toBe("paid");
  const retry = await request.post("/api/checkout", {
    headers: buyer,
    data: { requestKey: key, items: [{ productId: "p-knit", quantity: 1 }] },
  });
  expect(retry.status()).toBe(200);
  expect((await retry.json()).payment.id).toBe(order.payment.id);
  const db = new DatabaseSync(
    fileURLToPath(new URL("../data/test/market.sqlite", import.meta.url)),
    { readOnly: true },
  );
  expect(db.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(1);
  expect(db.prepare("SELECT COUNT(*) AS n FROM payments").get()?.n).toBe(1);
  db.close();
});
test("browser cart quantities and undiscounted checkout work", async ({
  page,
}) => {
  await bagToCheckout(page);
  await page.getByLabel("Quantity for The everyday knit").selectOption("2");
  await expect(page.getByTestId("checkout-total")).toHaveText("$96.00");
  await page.getByRole("button", { name: "Place simulated order" }).click();
  await expect(page.getByTestId("order-total")).toHaveText("$96.00");
  await expect(page.getByTestId("payment-total")).toHaveText("$96.00");
  await page.reload();
  await expect(page.getByTestId("payment-total")).toHaveText("$96.00");
});
test("identity and listing/order ownership are enforced on the server", async ({
  request,
}) => {
  expect((await request.get("/api/orders")).status()).toBe(401);
  expect(
    (
      await request.get("/api/orders", {
        headers: { "X-Demo-Account": "invented" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/checkout", { headers: seller, data: {} })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.put("/api/listings/p-knit", {
        headers: buyer,
        data: { price_cents: 1 },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.put("/api/listings/p-knit", {
        headers: otherSeller,
        data: { price_cents: 1 },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/listings/p-knit/photo", {
        headers: otherSeller,
        multipart: { photo },
      })
    ).status(),
  ).toBe(404);
  const order = await purchase(request);
  expect(
    (
      await request.get(`/api/orders/${order.id}`, { headers: otherBuyer })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.get(`/api/orders/${order.id}`, { headers: seller })
    ).status(),
  ).toBe(403);
});
test("server ignores client amounts, validates codes and rejects malformed carts", async ({
  request,
}) => {
  const order = await purchase(request, "INVALID", {
    total_cents: 1,
    amount_cents: 1,
    items: [{ productId: "p-knit", quantity: 1, price_cents: 1 }],
  });
  expect(order.discount_cents).toBe(0);
  expect(order.total_cents).toBe(4800);
  expect(order.payment.amount_cents).toBe(4800);
  const q = await request.post("/api/quote", {
    headers: buyer,
    data: {
      items: [
        { productId: "p-knit", quantity: 2 },
        { productId: "p-lamp", quantity: 1 },
      ],
      code: " loop20 ",
    },
  });
  expect(await q.json()).toMatchObject({
    subtotal_cents: 16100,
    discount_cents: 1920,
    total_cents: 14180,
  });
  for (const items of [
    [],
    [{ productId: "p-knit", quantity: -1 }],
    [{ productId: "p-knit", quantity: 1.5 }],
    [{ productId: "unknown", quantity: 1 }],
    [
      { productId: "p-knit", quantity: 1 },
      { productId: "p-knit", quantity: 1 },
    ],
  ])
    expect(
      (
        await request.post("/api/quote", { headers: buyer, data: { items } })
      ).status(),
    ).toBe(400);
});
test("seller can create and edit a listing; buyer can browse persisted changes", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await selectAccount(page, "seller-olive");
  await page.getByRole("link", { name: "Sell with us" }).click();
  await page.getByRole("button", { name: "Create listing" }).click();
  await page.getByLabel("Title", { exact: true }).fill("A blue linen shirt");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A fictional pre-loved linen shirt, size M.");
  await page.getByLabel("Price ($)", { exact: true }).fill("27.50");
  await page.getByRole("button", { name: "Save listing" }).click();
  const card = page
    .locator(".listing-card")
    .filter({ hasText: "A blue linen shirt" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Edit listing" }).click();
  await page.getByLabel("Price ($)", { exact: true }).fill("25.00");
  await page.getByRole("button", { name: "Save listing" }).click();
  await page.reload();
  await expect(
    page.locator(".listing-card").filter({ hasText: "A blue linen shirt" }),
  ).toContainText("$25.00");
  const products = await (await request.get("/api/products")).json();
  expect(
    products.find((p: any) => p.title === "A blue linen shirt").price_cents,
  ).toBe(2500);
});
test("PNG uploads return a served image; unsafe and oversized uploads are rejected", async ({
  request,
}) => {
  const response = await request.post("/api/listings/p-knit/photo", {
    headers: seller,
    multipart: { photo },
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  const asset = await request.get(result.photo_url);
  expect(asset.status()).toBe(200);
  expect(asset.headers()["content-type"]).toContain("image/png");
  expect(
    (
      await request.post("/api/listings/p-knit/photo", {
        headers: seller,
        multipart: {
          photo: {
            name: "x.png",
            mimeType: "image/png",
            buffer: Buffer.from("<script>alert(1)</script>"),
          },
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/listings/p-knit/photo", {
        headers: seller,
        multipart: {
          photo: {
            name: "large.png",
            mimeType: "image/png",
            buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
          },
        },
      })
    ).status(),
  ).toBe(400);
});
test("support complaints are saved against the selected account", async ({
  page,
}) => {
  await page.goto("/#/support");
  await page.getByRole("button", { name: /Fill out a form/ }).click();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Question about my find");
  await page
    .getByLabel("What happened?")
    .fill("This is a fictional support complaint.");
  await page.getByRole("button", { name: "Submit complaint" }).click();
  await expect(page.getByRole("status")).toContainText("Support ticket saved.");
  const db = new DatabaseSync(
    fileURLToPath(new URL("../data/test/market.sqlite", import.meta.url)),
    { readOnly: true },
  );
  expect(
    db.prepare("SELECT account_id,subject FROM support_tickets").get(),
  ).toMatchObject({
    account_id: "buyer-maya",
    subject: "Question about my find",
  });
  db.close();
});
test("mobile layout fits the viewport and account selector remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Local-only demo account")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/loop-market-mobile.png",
    fullPage: true,
  });
});
