import { test, expect } from "@playwright/test";
import {
  reset,
  buyer,
  otherBuyer,
  otherSeller,
  purchase,
  photo,
  selectAccount,
  bagToCheckout,
} from "./helpers";
test.beforeEach(() => reset());
test("discount: checkout, order, and payment agree after exactly one valid discount", async ({
  page,
  request,
}) => {
  await bagToCheckout(page);
  await page.getByLabel("Discount code").fill("LOOP20");
  await expect(page.getByTestId("checkout-total")).toHaveText("$38.40");
  await page.getByRole("button", { name: "Place simulated order" }).click();
  await expect(page.getByTestId("order-total")).toHaveText("$38.40");
  await expect.soft(page.getByTestId("payment-total")).toHaveText("$38.40");
  const id = await page.getByTestId("order-id").textContent();
  const saved = await (
    await request.get(`/api/orders/${id}`, { headers: buyer })
  ).json();
  expect.soft(saved.payment.amount_cents).toBe(saved.total_cents);
  expect(saved.discount_cents).toBe(960);
});
test("discount: invalid codes do not reduce the server-calculated payment", async ({
  request,
}) => {
  const order = await purchase(request, "NOTACODE", {
    total_cents: 1,
    amount_cents: 1,
  });
  expect(order.discount_cents).toBe(0);
  expect(order.total_cents).toBe(4800);
  expect(order.payment.amount_cents).toBe(4800);
});
test("discount: only eligible lines are discounted once across quantities", async ({
  request,
}) => {
  const order = await purchase(request, "LOOP20", {
    items: [
      { productId: "p-knit", quantity: 2 },
      { productId: "p-lamp", quantity: 1 },
    ],
    total_cents: 1,
  });
  expect(order.subtotal_cents).toBe(16100);
  expect(order.discount_cents).toBe(1920);
  expect(order.total_cents).toBe(14180);
  expect(order.payment.amount_cents).toBe(14180);
});
test("history: paid order is visible after refresh with matching items and no second payment", async ({
  page,
  request,
}) => {
  await bagToCheckout(page);
  await page.getByRole("button", { name: "Place simulated order" }).click();
  await expect(page.getByTestId("order-id")).toBeVisible();
  const id = (await page.getByTestId("order-id").textContent())!;
  const before = await (
    await request.get(`/api/orders/${id}`, { headers: buyer })
  ).json();
  await page.getByRole("link", { name: "View order history" }).click();
  await page.reload();
  await expect
    .soft(
      page.getByRole("link", { name: new RegExp(`Order ${id.slice(0, 8)}`) }),
    )
    .toBeVisible();
  const history = await (
    await request.get("/api/orders", { headers: buyer })
  ).json();
  expect.soft(history.some((o: any) => o.id === id)).toBe(true);
  const after = await (
    await request.get(`/api/orders/${id}`, { headers: buyer })
  ).json();
  expect(after.payment.id).toBe(before.payment.id);
  expect(after.items).toMatchObject([
    { title: "The everyday knit", quantity: 1, unit_cents: 4800 },
  ]);
  expect(after.total_cents).toBe(after.payment.amount_cents);
  expect(
    (await request.get(`/api/orders/${id}`, { headers: otherBuyer })).status(),
  ).toBe(404);
});
test("photo: uploaded image remains after refresh, new session, and buyer viewing", async ({
  page,
  browser,
  request,
}) => {
  await page.goto("/");
  await selectAccount(page, "seller-olive");
  await page.getByRole("link", { name: "Sell with us" }).click();
  const card = page.getByTestId("listing-p-knit");
  await card
    .getByLabel("Upload photo for The everyday knit")
    .setInputFiles(photo);
  await expect(card.locator("img")).toHaveAttribute("src", /^\/uploads\//);
  const saved = (await card.locator("img").getAttribute("src"))!;
  await page.reload();
  await expect.soft(card.locator("img")).toHaveAttribute("src", saved);
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.goto("http://127.0.0.1:3001");
  await selectAccount(fresh, "seller-olive");
  await fresh.getByRole("link", { name: "Sell with us" }).click();
  await expect
    .soft(fresh.getByTestId("listing-p-knit").locator("img"))
    .toHaveAttribute("src", saved);
  await selectAccount(fresh, "buyer-jamie");
  await fresh.goto("http://127.0.0.1:3001/#/products/p-knit");
  await expect
    .soft(fresh.locator(".detail-photo"))
    .toHaveAttribute("src", saved);
  expect(
    (
      await request.post("/api/listings/p-knit/photo", {
        headers: otherSeller,
        multipart: { photo },
      })
    ).status(),
  ).toBe(404);
  await context.close();
});
