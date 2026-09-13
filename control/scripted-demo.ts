import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import type { FixtureKind } from "./snapshots";
import { hash, revision } from "./snapshots";
import { now, projectRoot, problem } from "./paths";
import { IsolatedApp, probeIsolation } from "./agent/docker";
import { cleanCopy, mismatch } from "./agent/policy";

export const scriptedDemoModelCalls = 0;

export class ScriptedDemoService {
  active = false;
  abort?: AbortController;

  constructor(
    public store: Store,
    public isolationCheck = probeIsolation,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS scripted_investigations(
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      state TEXT NOT NULL,
      candidate_kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      base_revision TEXT,
      proposal_id TEXT,
      events TEXT NOT NULL,
      evidence TEXT NOT NULL,
      message TEXT NOT NULL
    );`);
    store.db
      .prepare(
        "UPDATE scripted_investigations SET state='Failed',finished_at=?,message='Controller restarted; scripted demonstration was interrupted.' WHERE finished_at IS NULL",
      )
      .run(now());
  }

  list(ticketId?: string) {
    const rows = ticketId
      ? this.store.db
          .prepare(
            "SELECT * FROM scripted_investigations WHERE ticket_id=? ORDER BY started_at DESC",
          )
          .all(ticketId)
      : this.store.db
          .prepare(
            "SELECT * FROM scripted_investigations ORDER BY started_at DESC",
          )
          .all();
    return (rows as any[]).map((row) => ({
      ...row,
      events: JSON.parse(row.events),
      evidence: JSON.parse(row.evidence),
      origin: "Scripted investigation + developer-authored proposal",
    }));
  }

  get(id: string): any {
    const row = this.store.db
      .prepare("SELECT * FROM scripted_investigations WHERE id=?")
      .get(id) as any;
    if (!row) problem("Scripted investigation not found.", 404);
    return {
      ...row,
      events: JSON.parse(row.events),
      evidence: JSON.parse(row.evidence),
      origin: "Scripted investigation + developer-authored proposal",
    };
  }

  private event(
    id: string,
    state: string,
    message: string,
    details: unknown = null,
  ) {
    const run = this.get(id);
    run.events.push({ at: now(), state, message, details });
    this.store.db
      .prepare(
        "UPDATE scripted_investigations SET state=?,events=?,message=? WHERE id=?",
      )
      .run(state, JSON.stringify(run.events), message, id);
  }

  cancel(id: string) {
    const run = this.get(id);
    if (!run.finished_at) {
      this.abort?.abort();
      this.event(id, "Cancelling", "Cancellation requested by Local engineer.");
    }
    return this.get(id);
  }

  async start(ticketId: string, kind: FixtureKind) {
    if (!(["discount-fix", "unchanged"] as string[]).includes(kind))
      problem(
        "Only the prepared discount fix and unchanged negative control are available.",
        400,
      );
    if (this.active)
      problem("A scripted investigation is already running.", 409);
    const ticket = (await this.store.receiveTicket(ticketId)) as any;
    if (ticket.customer_id !== "buyer-maya" || ticket.customer_role !== "buyer")
      problem(
        "The scripted discount demonstration is scoped to the Maya demo buyer.",
        409,
      );
    const id = randomUUID();
    this.active = true;
    this.abort = new AbortController();
    this.store.db
      .prepare(
        "INSERT INTO scripted_investigations(id,ticket_id,state,candidate_kind,started_at,events,evidence,message) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        ticketId,
        "Preparing isolated workspace",
        kind,
        now(),
        "[]",
        "[]",
        "Starting a real scripted browser reproduction. No model call will be made.",
      );
    void this.perform(id, ticket, kind, this.abort.signal)
      .catch((error) => {
        const state = this.abort?.signal.aborted ? "Cancelled" : "Failed";
        this.event(
          id,
          state,
          state === "Cancelled"
            ? "Scripted demonstration cancelled."
            : String(
                error instanceof Error
                  ? error.message
                  : "Scripted demonstration failed.",
              ),
        );
        this.store.db
          .prepare(
            "UPDATE scripted_investigations SET finished_at=? WHERE id=?",
          )
          .run(now(), id);
      })
      .finally(() => {
        this.active = false;
        this.abort = undefined;
      });
    return this.get(id);
  }

  private async perform(
    id: string,
    ticket: any,
    kind: FixtureKind,
    signal: AbortSignal,
  ) {
    const isolation = await this.isolationCheck();
    if (!isolation.ready || !isolation.image)
      throw new Error("Setup required: " + isolation.message);
    const root = path.join(this.store.dataDir, "scripted-investigations", id);
    const baseline = path.join(root, "baseline");
    const evidenceDir = path.join(root, "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    cleanCopy(projectRoot, baseline, true);
    const baseRevision = revision(baseline);
    this.store.db
      .prepare("UPDATE scripted_investigations SET base_revision=? WHERE id=?")
      .run(baseRevision, id);
    const app = new IsolatedApp(isolation.image);
    try {
      this.event(
        id,
        "Preparing isolated workspace",
        "Starting an unchanged disposable Loop Market baseline in Docker.",
        { baseRevision },
      );
      await app.start(baseline, signal, (output) =>
        writeFileSync(path.join(root, "build.log"), output, { flag: "a" }),
      );
      const action = async (value: any) => {
        signal.throwIfAborted();
        const result = await app.browserAction(value);
        if (!result.ok)
          throw new Error(
            `Scripted browser action failed: ${value.action} ${value.target ?? ""}`.trim(),
          );
        this.event(
          id,
          "Opening the customer workflow",
          `Browser action: ${value.action}`,
          {
            target: value.target ?? "affected buyer session",
            url: result.url,
          },
        );
        return result;
      };
      const selector = (
        observation: any,
        matches: (element: any) => boolean,
        description: string,
      ) => {
        const element = observation.elements?.find(matches);
        if (!element)
          throw new Error(
            `Scripted browser could not find ${description} in the latest trusted observation.`,
          );
        return element.selector;
      };
      await action({ action: "init", buyer: ticket.customer_id });
      let observation = await action({
        action: "open",
        target: "/#/products/p-knit",
      });
      observation = await action({
        action: "click",
        target: selector(
          observation,
          (element) =>
            element.tag === "button" && element.text.startsWith("Add to bag"),
          "the Add to bag button",
        ),
      });
      observation = await action({
        action: "click",
        target: selector(
          observation,
          (element) => element.href === "#/cart",
          "the bag link",
        ),
      });
      observation = await action({
        action: "click",
        target: selector(
          observation,
          (element) => element.href === "#/checkout",
          "the checkout link",
        ),
      });
      observation = await action({
        action: "fill",
        target: selector(
          observation,
          (element) => element.label === "Discount code",
          "the discount-code field",
        ),
        value: "LOOP20",
      });
      for (
        let attempt = 0;
        attempt < 20 && !observation.text?.includes("$38.40");
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        observation = await action({ action: "inspect" });
      }
      if (!observation.text?.includes("$38.40"))
        throw new Error(
          "The discounted checkout total did not appear before purchase.",
        );
      const receipt = await action({
        action: "click",
        target: selector(
          observation,
          (element) =>
            element.tag === "button" &&
            element.text === "Place simulated order",
          "the simulated-order button",
        ),
      });
      const recordName = "discount-reproduction.json";
      const screenshotName = "discount-reproduction.png";
      const image = Buffer.from(receipt.screenshot ?? "", "base64");
      if (image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
        throw new Error("The browser did not return a valid screenshot.");
      const evidence = {
        origin: "trusted-browser",
        mode: "scripted-investigation",
        base: baseRevision,
        buyer: ticket.customer_id,
        screenshot: screenshotName,
        record: recordName,
        ...receipt.receipt,
      };
      writeFileSync(path.join(evidenceDir, screenshotName), image, {
        flag: "wx",
      });
      writeFileSync(
        path.join(evidenceDir, recordName),
        JSON.stringify(evidence, null, 2),
        { flag: "wx" },
      );
      (evidence as any).sha256 = hash(
        readFileSync(path.join(evidenceDir, recordName)),
      );
      if (!mismatch(evidence, ticket.customer_id, baseRevision))
        throw new Error(
          "The scripted browser run did not reproduce the $38.40 order / $48.00 payment mismatch.",
        );
      this.store.db
        .prepare("UPDATE scripted_investigations SET evidence=? WHERE id=?")
        .run(JSON.stringify([evidence]), id);
      this.event(
        id,
        "Reproduction observed",
        "Fresh browser evidence captured a $38.40 order total and $48.00 recorded payment.",
        evidence,
      );
      const proposal = this.store.create(ticket.id, kind, "scripted-agent-1");
      this.store.submit(proposal.id, "Scripted investigation");
      this.store.db
        .prepare(
          "UPDATE scripted_investigations SET state='Awaiting engineer review',proposal_id=?,finished_at=?,message=? WHERE id=?",
        )
        .run(
          proposal.id,
          now(),
          "Real scripted reproduction complete. Developer-authored candidate loaded and ready for Agent 2.",
          id,
        );
      this.store.event(
        ticket.id,
        proposal.id,
        "Scripted investigation",
        "Scripted reproduction attached",
        {
          investigationId: id,
          evidence: [screenshotName, recordName],
          modelCalls: 0,
        },
      );
    } finally {
      await app.close();
    }
  }

  artifact(id: string, name: string) {
    const run = this.get(id);
    if (
      !run.evidence.some(
        (entry: any) => entry.screenshot === name || entry.record === name,
      )
    )
      problem("Scripted investigation evidence not found.", 404);
    return path.join(
      this.store.dataDir,
      "scripted-investigations",
      id,
      "evidence",
      name,
    );
  }
}
