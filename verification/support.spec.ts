import { test, expect, type Page } from "@playwright/test";
import { reset } from "./helpers";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { createControl } from "../control/app";
import { projectRoot } from "../control/paths";
import { investigationPrompt } from "../control/agent/policy";

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

test("voice and form complaints persist identically and reach the same investigation handoff", async ({
  page,
}) => {
  const subject = "Discount payment mismatch";
  const message =
    "Reviewed by customer: LOOP20 showed $38.40; I paid $48.00. Order TEST-42.";
  await mockVoice(page);
  await openVoice(page);
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect(page.getByRole("log")).toBeVisible();
  await page.getByRole("button", { name: "End & review complaint" }).click();
  await page.getByLabel("What happened?").fill(message);
  const voiceSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/support") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit complaint" }).click();
  const voiceResponse = await voiceSaved;
  expect(voiceResponse.status()).toBe(201);
  const voiceId = (await voiceResponse.json()).id;
  await expect(page.getByRole("status")).toContainText(voiceId);

  // Submit identical reviewed content through the form using the same customer.
  await page.reload();
  await page.getByRole("button", { name: /Fill out a form/ }).click();
  await page.getByLabel("Subject", { exact: true }).fill(subject);
  await page.getByLabel("What happened?").fill(message);
  const formSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/support") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit complaint" }).click();
  const formResponse = await formSaved;
  expect(formResponse.status()).toBe(201);
  const formId = (await formResponse.json()).id;
  expect(formId).not.toBe(voiceId);
  await expect(page.getByRole("status")).toContainText(formId);
  await page.reload();

  const ticketSource = path.join(projectRoot, "data/test/market.sqlite");
  const database = new DatabaseSync(ticketSource, { readOnly: true });
  try {
    const rows = database
      .prepare("SELECT * FROM support_tickets ORDER BY id")
      .all();
    expect(rows).toHaveLength(2);
    for (const id of [voiceId, formId]) {
      expect(rows.find((row) => row.id === id)).toMatchObject({
        account_id: "buyer-maya",
        subject,
        message,
      });
    }
    const before = JSON.stringify(rows);
    const testRoot = mkdtempSync(
      path.join(projectRoot, "test-results/intake-handoff-"),
    );
    // Exercise the real authenticated controller and dispatch. Replace only the
    // model/Docker execution boundary so this regression makes no paid calls.
    const control = createControl({
      dataDir: path.join(testRoot, "controller"),
      privateDir: path.join(testRoot, "private"),
      ticketSource,
      agentStatus: async () => ({ state: "Ready" }) as any,
    });
    const received: any[] = [];
    control.agent.investigate = async (runId, ticket) => {
      received.push(ticket);
      control.agent.finish(
        runId,
        "Needs more information",
        "Test-only dispatch capture. No model or Docker execution.",
      );
    };
    const server = control.app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as any).port}/engineer-api`;
      const login = await fetch(url + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(JSON.parse(readFileSync(control.keyFile, "utf8"))),
      });
      expect(login.status).toBe(200);
      const { token } = await login.json();
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const inboxResponse = await fetch(url + "/inbox", { headers });
      expect(inboxResponse.status).toBe(200);
      const inbox = await inboxResponse.json();
      for (const id of [voiceId, formId]) {
        expect(inbox.find((ticket: any) => ticket.id === id)).toMatchObject({
          subject,
          complaint: message,
          customer_id: "buyer-maya",
          customer_name: "Maya Chen",
          customer_role: "buyer",
        });
        const started = await fetch(`${url}/tickets/${id}/investigate`, {
          method: "POST",
          headers,
          body: "{}",
        });
        expect(started.status).toBe(202);
        expect((await started.json()).ticket_id).toBe(id);
        await expect.poll(() => control.agent.active).toBe(false);
        expect(
          control.store.db.prepare("SELECT * FROM tickets WHERE id=?").get(id),
        ).toMatchObject({
          id,
          subject,
          complaint: message,
          customer_id: "buyer-maya",
        });
      }
      expect(received).toHaveLength(2);
      expect(received.map((ticket) => ticket.id)).toEqual([voiceId, formId]);
      expect(investigationPrompt(received[0])).toBe(
        investigationPrompt(received[1]),
      );
      expect(investigationPrompt(received[0])).toContain(message);
      expect(
        JSON.stringify(
          database.prepare("SELECT * FROM support_tickets ORDER BY id").all(),
        ),
      ).toBe(before);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      control.store.close();
    }
  } finally {
    database.close();
  }
});
