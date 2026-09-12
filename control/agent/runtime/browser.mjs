import { chromium } from "@playwright/test";
import { createInterface } from "node:readline";
const origin = "http://127.0.0.1:3001";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  serviceWorkers: "block",
  acceptDownloads: false,
});
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === origin
    ? route.continue()
    : route.abort(),
);
await context.routeWebSocket(/.*/, (ws) => ws.close());
const page = await context.newPage();
page.setDefaultTimeout(8000);
context.on("page", (p) => {
  if (p !== page) void p.close();
});
const responses = [];
const pending = new Set();
let displayedCents = null,
  checkout = null,
  buyer = null;
page.on("response", (response) => {
  const task = (async () => {
    const url = new URL(response.url());
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return;
    try {
      const body = await response.json();
      const row = {
        path: url.pathname,
        status: response.status(),
        method: response.request().method(),
        body,
      };
      responses.push(row);
      if (responses.length > 40) responses.shift();
      if (
        url.pathname === "/api/checkout" &&
        row.method === "POST" &&
        row.status === 201
      )
        checkout = row;
    } catch {}
  })();
  pending.add(task);
  task.finally(() => pending.delete(task));
});
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const a = JSON.parse(line);
    if (a.action === "init") {
      if (!["buyer-maya", "buyer-jamie"].includes(a.buyer))
        throw new Error("Unsupported affected synthetic buyer");
      buyer = a.buyer;
      await context.setExtraHTTPHeaders({ "X-Demo-Account": buyer });
      await page.goto(origin);
      await page.getByLabel("Local-only demo account").selectOption(buyer);
    } else if (a.action === "open") {
      if (
        !a.target.startsWith("/") ||
        a.target.startsWith("//") ||
        new URL(a.target, origin).origin !== origin
      )
        throw new Error("Assigned marketplace only");
      await page.goto(origin + a.target);
    } else if (["click", "fill", "select"].includes(a.action)) {
      const selector = a.target;
      if (
        typeof selector !== "string" ||
        selector.length > 300 ||
        selector.includes(">>")
      )
        throw new Error("Use a simple CSS selector");
      const total = await page
        .getByTestId("checkout-total")
        .textContent()
        .catch(() => null);
      if (total && /^\$\d+\.\d{2}$/.test(total.trim()))
        displayedCents = Math.round(Number(total.replace("$", "")) * 100);
      const element = page.locator(selector);
      if (a.action === "click") await element.click();
      if (a.action === "fill") await element.fill(a.value);
      if (a.action === "select") {
        if (selector.includes("account") && a.value !== buyer)
          throw new Error("Use the affected customer");
        await element.selectOption(a.value);
      }
    } else if (!["inspect", "screenshot", "responses"].includes(a.action))
      throw new Error("Unsupported browser action");
    await page.waitForLoadState("networkidle");
    await Promise.all([...pending]);
    const screenshot = (await page.screenshot({ fullPage: true })).toString(
      "base64",
    );
    let receipt = null;
    if (checkout) {
      const response = await context.request.get(
        `${origin}/api/orders/${encodeURIComponent(checkout.body.id)}`,
        { headers: { "X-Demo-Account": buyer } },
      );
      const body = await response.json();
      receipt = {
        checkoutStatus: checkout.status,
        receiptStatus: response.status(),
        orderId: body.id,
        orderCents: body.total_cents,
        paymentCents: body.payment?.amount_cents,
        discountCents: body.discount_cents,
        displayedCents,
        buyer,
      };
    }
    const elements = await page
      .locator("a,button,input,select,textarea")
      .evaluateAll((nodes) =>
        nodes.map((n, i) => ({
          selector: `${n.tagName.toLowerCase()}:nth-of-type(${
            Array.from(n.parentElement.children)
              .filter((e) => e.tagName === n.tagName)
              .indexOf(n) + 1
          })`,
          id: n.id,
          testId: n.getAttribute("data-testid"),
          label: n.getAttribute("aria-label"),
          text: n.textContent?.trim().slice(0, 160),
          href: n.getAttribute("href"),
          name: n.getAttribute("name"),
          type: n.getAttribute("type"),
          options:
            n.tagName === "SELECT"
              ? Array.from(n.options).map((o) => ({
                  value: o.value,
                  text: o.text,
                }))
              : undefined,
        })),
      );
    send({
      ok: true,
      url: page.url(),
      text: (await page.locator("body").innerText()).slice(0, 22000),
      elements,
      responses,
      receipt,
      screenshot,
    });
  } catch {
    send({
      ok: false,
      error:
        "Browser action failed. Inspect the current page and choose an unambiguous CSS selector on the assigned marketplace.",
    });
  }
}
await browser.close();
