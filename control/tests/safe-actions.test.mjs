import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import {
  safeRequest,
  resolveElement,
  assertSafeElement,
} from "../agent/runtime/safe-actions.mjs";
import { observePage } from "../agent/runtime/observation.mjs";
import { executePlan } from "../agent/plans.ts";

test("real browser batches allow safe controls and refuse checkout, payment, uploads and support submissions", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const origin = "http://127.0.0.1:3001";
    await page.route("**/*", (route) =>
      route.fulfill({ body: "<html></html>", contentType: "text/html" }),
    );
    await page.goto(origin);
    await page.setContent(`<a href="${origin}/#/checkout">Checkout</a>
      <button onclick="window.added=(window.added||0)+1">Add to bag — $48.00</button>
      <label>Promo code<input></label><select aria-label="Local-only demo account"><option value="buyer-maya">Maya</option></select>
      <button>Place order</button><button>Create payment</button><input type="file" aria-label="Photo">
      <form><button>Submit support ticket</button></form>`);
    const actions = [
      { action: "click", target: "text:Add to bag — $48.00", value: "" },
      { action: "fill", target: "label:Promo code", value: "LOOP20" },
      {
        action: "select",
        target: "label:Local-only demo account",
        value: "buyer-maya",
      },
    ].map((a) => ({ ...a, summary: "test" }));
    const result = await executePlan(
      {
        action: "batch",
        target: "",
        value: JSON.stringify(actions),
        summary: "test",
      },
      async (a, safeOnly) => {
        assert.equal(safeOnly, true);
        const selectors = new Set(
          (await observePage(page)).elements.map((e) => e.selector),
        );
        const element = await resolveElement(page, a.target, selectors);
        await assertSafeElement(element, a.action, origin);
        if (a.action === "click") await element.click();
        if (a.action === "fill") await element.fill(a.value);
        if (a.action === "select") await element.selectOption(a.value);
        return { ok: true };
      },
    );
    assert.equal(result.completed, 3, JSON.stringify(result));
    assert.ok(result.observations.every((o) => o.result.ok));
    assert.equal(await page.evaluate(() => window.added), 1);
    assert.equal(await page.getByLabel("Promo code").inputValue(), "LOOP20");
    for (const label of [
      "Place order",
      "Create payment",
      "Submit support ticket",
    ]) {
      await assert.rejects(
        assertSafeElement(
          page.getByText(label, { exact: true }),
          "click",
          origin,
        ),
        /separate explicit/,
      );
    }
    await assert.rejects(
      assertSafeElement(page.getByLabel("Photo"), "fill", origin),
    );
    for (const pathname of [
      "/api/checkout",
      "/api/payments",
      "/api/uploads",
      "/api/support",
    ]) {
      assert.equal(safeRequest("POST", origin + pathname, origin), false);
    }
    assert.equal(safeRequest("POST", origin + "/api/quote", origin), true);
    assert.equal(safeRequest("GET", "https://example.com", origin), false);
  } finally {
    await browser.close();
  }
});
