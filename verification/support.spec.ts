import { test, expect, type Page } from "@playwright/test";
import { reset } from "./helpers";

test.beforeEach(() => reset());
async function mockVoice(page: Page, scenario = "draft") {
  await page.route("**/api/support/voice/status", (route) =>
    route.fulfill({ json: { available: true } }),
  );
  await page.route("**/api/support/voice/session", (route) =>
    route.fulfill({ json: { signedUrl: "wss://api.elevenlabs.io/mock" } }),
  );
  // Simulate only the external voice adapter. Ticket submission still uses the real API and SQLite.
  await page.route("**/assets/voice-client-*.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export async function startVoiceSession(url, cb) {
      window.voiceTest = { ended: 0, muted: false };
      if (${JSON.stringify(scenario)} === 'denied') throw new DOMException('Denied', 'NotAllowedError');
      const session = {
        async endSession() { window.voiceTest.ended++; },
        setMicMuted(value) { window.voiceTest.muted = value; }
      };
      if (${JSON.stringify(scenario)} === 'delayed') await new Promise(resolve => setTimeout(resolve, 600));
      cb.onMessage('agent', 'What happened with your order?');
      cb.onMessage('user', 'LOOP20 showed $38.40 but I paid $48.00.');
      if (${JSON.stringify(scenario)} === 'draft') cb.onDraft({ subject: 'Discount payment mismatch', message: 'LOOP20 showed $38.40 but my simulated payment was $48.00.' });
      return session;
    }
  `,
    }),
  );
}
async function openVoice(page: Page) {
  await page.goto("/#/support");
  await page.getByRole("button", { name: /Talk it through/ }).click();
}
test("support begins with a choice and voice setup failure offers the working form", async ({
  page,
  request,
}) => {
  await openVoice(page);
  await expect(
    page.getByRole("button", { name: /Fill out a form/, exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start conversation", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Voice support isn’t available yet.", { exact: false }),
  ).toBeVisible();
  expect((await request.post("/api/support/voice/session")).status()).toBe(401);
  await page.getByRole("button", { name: "Use the form instead" }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toBeVisible();
});
test("voice prepares an editable draft, mute and end work, and only submission saves the ticket", async ({
  page,
}) => {
  await mockVoice(page);
  let submissions = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/support") && req.method() === "POST")
      submissions++;
  });
  await openVoice(page);
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("LOOP20 showed $38.40");
  expect(submissions).toBe(0);
  await page
    .getByRole("button", { name: "Mute microphone", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).voiceTest.muted)).toBe(true);
  await page.getByRole("button", { name: "End & review complaint" }).click();
  expect(await page.evaluate(() => (window as any).voiceTest.ended)).toBe(1);
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(
    "Discount payment mismatch",
  );
  await page
    .getByLabel("What happened?")
    .fill("Reviewed by customer: LOOP20 showed $38.40; I paid $48.00.");
  const submitted = page.waitForRequest(
    (req) => req.url().endsWith("/api/support") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "Submit complaint" }).click();
  expect((await submitted).postDataJSON()).toEqual({
    subject: "Discount payment mismatch",
    message: "Reviewed by customer: LOOP20 showed $38.40; I paid $48.00.",
  });
  await expect(page.getByRole("status")).toContainText(
    "Support ticket saved. Reference:",
  );
  expect(submissions).toBe(1);
});
test("without a draft tool, ending a call keeps the customer's words and switching to form preserves them", async ({
  page,
}) => {
  await mockVoice(page, "transcript");
  await openVoice(page);
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect(page.getByRole("log")).toBeVisible();
  await page.getByRole("button", { name: "Use the form instead" }).click();
  await expect(page.getByLabel("What happened?")).toHaveValue(
    "LOOP20 showed $38.40 but I paid $48.00.",
  );
  expect(await page.evaluate(() => (window as any).voiceTest.ended)).toBe(1);
});
test("microphone denial is recoverable and does not submit a complaint", async ({
  page,
}) => {
  await mockVoice(page, "denied");
  await openVoice(page);
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone access was denied",
  );
  await page.getByRole("button", { name: "Use the form instead" }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toBeVisible();
});
test("navigating away during connection closes a late session and ignores its transcript", async ({
  page,
}) => {
  await mockVoice(page, "delayed");
  await openVoice(page);
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).voiceTest)))
    .toBe(true);
  await page.evaluate(() => {
    location.hash = "/";
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).voiceTest.ended))
    .toBe(1);
  await page.goto("/#/support");
  await page.getByRole("button", { name: /Fill out a form/ }).click();
  await expect(page.getByLabel("What happened?")).toHaveValue("");
});
test("support choices and voice fallback fit a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openVoice(page);
  await expect(
    page.getByRole("button", { name: "Use the form instead" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
