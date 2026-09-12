import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
const harnessRoot = fileURLToPath(new URL("../", import.meta.url));
const root = process.env.TWO_DB_APP_ROOT || harnessRoot;
export function reset() {
  execFileSync(
    process.execPath,
    [path.join(harnessRoot, "node_modules/tsx/dist/cli.mjs"), "server/reset.ts"],
    { cwd: root, env: { ...process.env, LOOP_TEST: "1" } },
  );
}
export const buyer = { "X-Demo-Account": "buyer-maya" };
export const otherBuyer = { "X-Demo-Account": "buyer-jamie" };
export const seller = { "X-Demo-Account": "seller-olive" };
export const otherSeller = { "X-Demo-Account": "seller-theo" };
export async function purchase(
  request: APIRequestContext,
  code = "",
  extra: Record<string, unknown> = {},
) {
  const response = await request.post("/api/checkout", {
    headers: buyer,
    data: {
      items: [{ productId: "p-knit", quantity: 1 }],
      code,
      requestKey: crypto.randomUUID(),
      ...extra,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
export async function selectAccount(page: Page, id: string) {
  await page.getByLabel("Local-only demo account").selectOption(id);
}
export async function bagToCheckout(page: Page) {
  await page.goto("/#/products/p-knit");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await page.getByRole("link", { name: /^Bag/ }).click();
  await page.getByRole("link", { name: "Continue to checkout" }).click();
  await expect(page.getByTestId("checkout-total")).toHaveText("$48.00");
}
export const photo = {
  name: "customer-photo.png",
  mimeType: "image/png",
  buffer: readFileSync(new URL('./fixtures/seller-photo.png', import.meta.url)),
};
