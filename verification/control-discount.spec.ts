import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { discountRequirements } from "./discount-contract";
import {
  reset,
  buyer,
  otherBuyer,
  seller,
  purchase,
  bagToCheckout,
} from "./helpers";

test.beforeEach(() => reset());
function database() {
  if (!process.env.TWO_DB_APP_ROOT)
    throw new Error("Controller application root is required.");
  return new DatabaseSync(
    path.join(process.env.TWO_DB_APP_ROOT, "data/test/market.sqlite"),
    { readOnly: true },
  );
}
async function observe(id: string, observed: unknown) {
  const requirement = discountRequirements.find((r) => r.id === id)!;
  await test
    .info()
    .attach("observation", {
      body: JSON.stringify({ id, expected: requirement.expected, observed }),
      contentType: "application/json",
    });
  expect(observed).toEqual(requirement.expected);
}

test("D01 Discounted receipt and recorded payment agree", async ({
  page,
  request,
}) => {
  await bagToCheckout(page);
  await page.getByLabel("Discount code").fill("LOOP20");
  await expect(page.getByTestId("checkout-total")).toHaveText("$38.40");
  const displayed = await page.getByTestId("checkout-total").innerText();
  await page.getByRole("button", { name: "Place simulated order" }).click();
  await expect(page.getByTestId("order-id")).toBeVisible();
  const id = await page.getByTestId("order-id").innerText();
  const response = await request.get(`/api/orders/${id}`, { headers: buyer });
  expect(response.status()).toBe(200);
  const order = await response.json();
  const db = database();
  const saved = db
    .prepare("SELECT amount_cents FROM payments WHERE order_id=?")
    .get(id);
  db.close();
  await page.screenshot({
    path: test.info().outputPath("receipt.png"),
    fullPage: true,
  });
  await test
    .info()
    .attach("receipt", {
      path: test.info().outputPath("receipt.png"),
      contentType: "image/png",
    });
  await observe("D01", {
    displayed,
    order: order.total_cents,
    payment: order.payment.amount_cents,
    storedPayment: saved?.amount_cents,
    discount: order.discount_cents,
  });
  await expect(page.getByTestId("order-total")).toHaveText("$38.40");
  await expect(page.getByTestId("payment-total")).toHaveText("$38.40");
});
test("D02 Eligibility and quantities", async ({ request }) => {
  const o = await purchase(request, "LOOP20", {
    items: [
      { productId: "p-knit", quantity: 2 },
      { productId: "p-lamp", quantity: 1 },
    ],
  });
  await observe("D02", {
    subtotal: o.subtotal_cents,
    discount: o.discount_cents,
    order: o.total_cents,
    payment: o.payment.amount_cents,
  });
});
test("D03 Combined subtotal whole-cent floor rounding", async ({ request }) => {
  for (const [id, price] of [
    ["p-knit", 4803],
    ["p-vase", 3203],
  ] as const) {
    const p = await (await request.get(`/api/products/${id}`)).json();
    expect(
      (
        await request.put(`/api/listings/${id}`, {
          headers: seller,
          data: { ...p, price_cents: price },
        })
      ).status(),
    ).toBe(200);
  }
  const o = await purchase(request, "LOOP20", {
    items: [
      { productId: "p-knit", quantity: 1 },
      { productId: "p-vase", quantity: 1 },
    ],
  });
  await observe("D03", {
    subtotal: o.subtotal_cents,
    discount: o.discount_cents,
    order: o.total_cents,
    payment: o.payment.amount_cents,
  });
});
test("D04 Undiscounted checkout", async ({ request }) => {
  const o = await purchase(request, "", {
    items: [{ productId: "p-knit", quantity: 2 }],
  });
  await observe("D04", {
    order: o.total_cents,
    payment: o.payment.amount_cents,
    discount: o.discount_cents,
  });
});
test("D05 Invalid discount code", async ({ request }) => {
  const o = await purchase(request, "INVALID");
  await observe("D05", {
    order: o.total_cents,
    payment: o.payment.amount_cents,
    discount: o.discount_cents,
  });
});
test("D06 Buyer order isolation", async ({ request }) => {
  const o = await purchase(request);
  await observe("D06", {
    ownerStatus: (
      await request.get(`/api/orders/${o.id}`, { headers: buyer })
    ).status(),
    otherBuyerStatus: (
      await request.get(`/api/orders/${o.id}`, { headers: otherBuyer })
    ).status(),
  });
});
test("D07 Buyer-scoped retry deduplication", async ({ request }) => {
  const requestKey = crypto.randomUUID(),
    o = await purchase(request, "LOOP20", { requestKey });
  const retry = await request.post("/api/checkout", {
    headers: buyer,
    data: {
      requestKey,
      items: [{ productId: "p-knit", quantity: 1 }],
      code: "LOOP20",
    },
  });
  expect(retry.status()).toBe(200);
  const again = await retry.json();
  const db = database(),
    orders = db.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n,
    payments = db.prepare("SELECT COUNT(*) AS n FROM payments").get()?.n;
  db.close();
  const other = await request.post("/api/checkout", {
    headers: otherBuyer,
    data: { requestKey, items: [{ productId: "p-knit", quantity: 1 }] },
  });
  expect(other.status()).toBe(201);
  const another = await other.json();
  await observe("D07", {
    sameOrder: o.id === again.id,
    samePayment: o.payment.id === again.payment.id,
    orders,
    payments,
    buyerScoped: another.id !== o.id && another.payment.id !== o.payment.id,
  });
});
test("D08 Client cannot set price or payment amount", async ({ request }) => {
  const o = await purchase(request, "", {
    total_cents: 1,
    amount_cents: 1,
    items: [{ productId: "p-knit", quantity: 1, price_cents: 1 }],
  });
  const edit = await request.put("/api/listings/p-knit", {
    headers: buyer,
    data: { price_cents: 1 },
  });
  await observe("D08", {
    order: o.total_cents,
    payment: o.payment.amount_cents,
    priceEditStatus: edit.status(),
  });
});
