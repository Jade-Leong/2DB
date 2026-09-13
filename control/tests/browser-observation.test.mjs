import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { observePage } from "../agent/runtime/observation.mjs";
import { ObservationContext } from "../agent/observations.ts";

test("visible controls receive unique stable references despite repeated nested tags", async () => {
  const server = createServer((_req, res) =>
    res.end(
      '<div><button>Wrong</button></div><div><button>Correct</button></div><button hidden>Hidden</button><label>Name<input value="Maya"></label>',
    ),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port);
    const first = await observePage(page);
    assert.equal(first.elements.length, 3);
    assert.equal(new Set(first.elements.map((e) => e.selector)).size, 3);
    for (const e of first.elements)
      assert.equal(await page.locator(e.selector).count(), 1);
    await page
      .locator(first.elements.find((e) => e.text === "Correct").selector)
      .click();
    const second = await observePage(page);
    assert.deepEqual(first.elements, second.elements);
    await page.locator("input").fill("Jamie");
    const third = await observePage(page);
    assert.equal(third.elements.at(-1).value, "Jamie");
    assert.equal(third.elements.at(-1).label, "Name");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});

test("unchanged observations omit repeated page data while preserving measured receipt values", () => {
  const context = new ObservationContext();
  const data = {
    ok: true,
    url: "/checkout",
    text: "Checkout",
    elements: [{ selector: "ref" }],
    receipt: { displayedCents: 3840, paymentCents: 4800 },
    responses: Array.from({ length: 40 }, (_, i) => ({
      path: "/api/products",
      method: "GET",
      status: 200,
      body: { large: "x".repeat(20000), i },
    })),
  };
  const first = context.browser(data),
    second = context.browser(data);
  assert.equal(first.responses.length, 5);
  assert.equal(first.responses[0].body, undefined);
  assert.equal(second.unchanged, true);
  assert.equal(second.elements, undefined);
  assert.equal(second.text, undefined);
  assert.deepEqual(second.receipt, data.receipt);
  assert.ok(JSON.stringify(second).length < 1500);
  assert.equal(context.browser({ ...data, text: "Receipt" }).text, "Receipt");
});
