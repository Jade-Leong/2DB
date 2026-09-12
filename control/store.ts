import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { now, problem, projectRoot } from "./paths";
import {
  initializeFixtures,
  selectedFixture,
  assertFixtures,
  harnessRevision,
  hash,
  type FixtureKind,
  revision,
} from "./snapshots";
import { discountRequirements } from "../verification/discount-contract";

export class Store {
  db: DatabaseSync;
  fixtures: ReturnType<typeof initializeFixtures>;
  ticketSource: string;
  constructor(
    public dataDir: string,
    ticketSource = path.join(projectRoot, "data/local/market.sqlite"),
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.ticketSource = ticketSource;
    this.fixtures = initializeFixtures(dataDir);
    this.db = new DatabaseSync(path.join(dataDir, "controller.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, customer_name TEXT NOT NULL, customer_role TEXT NOT NULL, subject TEXT NOT NULL, complaint TEXT NOT NULL, submitted_at TEXT NOT NULL, related_reference TEXT, imported_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), kind TEXT NOT NULL, base_revision TEXT NOT NULL, candidate_revision TEXT NOT NULL, requirements TEXT NOT NULL, requirements_hash TEXT NOT NULL, harness_hash TEXT NOT NULL, diff TEXT NOT NULL, explanation TEXT NOT NULL, state TEXT NOT NULL, revision_number INTEGER NOT NULL, current_approval TEXT, last_run TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id), reviewer TEXT NOT NULL, revision TEXT NOT NULL, base_revision TEXT NOT NULL, requirements_hash TEXT NOT NULL, harness_hash TEXT NOT NULL, revision_number INTEGER NOT NULL, created_at TEXT NOT NULL, invalidated_at TEXT);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL REFERENCES proposals(id), approval_id TEXT NOT NULL, candidate_revision TEXT NOT NULL, base_revision TEXT NOT NULL, requirements_hash TEXT NOT NULL, harness_hash TEXT NOT NULL, revision_number INTEGER NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, evidence TEXT, message TEXT);
   CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,ticket_id TEXT NOT NULL,proposal_id TEXT,actor TEXT NOT NULL,event TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);`);
    const interrupted = this.db
      .prepare("SELECT * FROM runs WHERE state='Verification running'")
      .all() as any[];
    for (const run of interrupted) {
      this.db
        .prepare(
          "UPDATE runs SET state='Inconclusive',finished_at=?,message=? WHERE id=?",
        )
        .run(
          now(),
          "Controller stopped before complete evidence was recorded.",
          run.id,
        );
      this.db
        .prepare(
          "UPDATE proposals SET state='Inconclusive',updated_at=? WHERE id=?",
        )
        .run(now(), run.proposal_id);
      this.event(
        this.proposal(run.proposal_id).ticket_id,
        run.proposal_id,
        "Controller",
        "Verification interrupted",
        "Previous process did not finish.",
      );
    }
  }
  inbox(): any[] {
    if (!existsSync(this.ticketSource)) return [];
    const source = new DatabaseSync(this.ticketSource, { readOnly: true });
    try {
      source.exec("PRAGMA query_only=ON");
      return source
        .prepare(
          "SELECT t.id,t.account_id AS customer_id,a.name AS customer_name,a.role AS customer_role,t.subject,t.message AS complaint,t.created_at AS submitted_at FROM support_tickets t JOIN accounts a ON a.id=t.account_id ORDER BY t.created_at DESC",
        )
        .all()
        .map((t) => ({
          ...t,
          related_reference: null,
          imported: !!this.db
            .prepare("SELECT id FROM tickets WHERE id=?")
            .get(t.id),
        }));
    } finally {
      source.close();
    }
  }
  importTicket(id: string) {
    const existing = this.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .get(id);
    if (existing) return existing;
    const t = this.inbox().find((t) => t.id === id);
    if (!t) problem("Submitted marketplace ticket not found.", 404);
    this.db
      .prepare("INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        t.id,
        t.customer_id,
        t.customer_name,
        t.customer_role,
        t.subject,
        t.complaint,
        t.submitted_at,
        null,
        now(),
      );
    this.event(
      id,
      null,
      "Local engineer",
      "Ticket received",
      "Original complaint copied through a read-only adapter. No diagnosis attached.",
    );
    return this.db.prepare("SELECT * FROM tickets WHERE id=?").get(id);
  }
  event(
    ticket: string,
    proposal: string | null,
    actor: string,
    event: string,
    details: unknown,
  ) {
    this.db
      .prepare(
        "INSERT INTO activity(ticket_id,proposal_id,actor,event,details,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        ticket,
        proposal,
        actor,
        event,
        typeof details === "string" ? details : JSON.stringify(details),
        now(),
      );
  }
  proposal(id: string): any {
    const row = this.db.prepare("SELECT * FROM proposals WHERE id=?").get(id);
    if (!row) problem("Proposal not found.", 404);
    return row;
  }
  create(ticketId: string, kind: FixtureKind) {
    this.importTicket(ticketId);
    assertFixtures(this.fixtures);
    const f = selectedFixture(this.fixtures, kind),
      id = randomUUID(),
      timestamp = now(),
      requirements = JSON.stringify(discountRequirements);
    this.db
      .prepare("INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        ticketId,
        kind,
        this.fixtures.base.revision,
        f.revision,
        requirements,
        hash(requirements),
        harnessRevision(),
        kind === "discount-fix"
          ? this.fixtures.diff
          : "No source changes. Candidate is byte-for-byte identical to the baseline.",
        kind === "discount-fix"
          ? "Developer-authored fixture: use the canonical server quote total when recording the simulated payment. Pricing, eligibility, rounding, ownership, and retry handling are preserved."
          : "Developer-authored negative control: identical source. Approval grants permission to test, not a passing result.",
        "Proposal ready",
        1,
        null,
        null,
        timestamp,
        timestamp,
      );
    this.event(ticketId, id, "Developer-authored fixture", "Proposal ready", {
      kind,
      revision: f.revision,
    });
    return this.detail(id);
  }
  invalidate(p: any, message: string) {
    this.db
      .prepare(
        "UPDATE approvals SET invalidated_at=? WHERE proposal_id=? AND invalidated_at IS NULL",
      )
      .run(now(), p.id);
    this.db
      .prepare(
        "UPDATE proposals SET current_approval=NULL,state='Awaiting engineer approval',updated_at=? WHERE id=?",
      )
      .run(now(), p.id);
    this.event(
      p.ticket_id,
      p.id,
      "Controller",
      "Approval invalidated",
      message,
    );
  }
  checkCurrent(p: any) {
    try {
      if (p.kind === "agent-generated") {
        const c = this.agentCandidate(p.id);
        if (
          revision(c.base_root) !== p.base_revision ||
          revision(c.candidate_root) !== p.candidate_revision
        )
          problem(
            "Agent candidate bytes changed. Previous approval is invalid; start a new investigation.",
            409,
          );
      } else assertFixtures(this.fixtures);
    } catch (e) {
      if (p.current_approval)
        this.invalidate(
          p,
          "Source bytes changed. Unreviewed fixture execution is blocked.",
        );
      throw e;
    }
    if (p.harness_hash !== harnessRevision()) {
      if (p.current_approval)
        this.invalidate(
          p,
          "Trusted harness changed. Create a new proposal to freeze the updated requirements and harness.",
        );
      problem(
        "Trusted harness changed. Create a new proposal for review.",
        409,
      );
    }
    if (
      p.kind !== "agent-generated" &&
      selectedFixture(this.fixtures, p.kind).revision !== p.candidate_revision
    )
      problem("Candidate identity does not match the trusted fixture.", 409);
  }
  change(id: string, kind: FixtureKind) {
    const p = this.proposal(id);
    if (p.kind === "agent-generated")
      problem(
        "Agent proposals cannot be replaced with a fixture. Request changes and start a fresh investigation.",
        409,
      );
    if (p.state === "Verification running")
      problem(
        "Wait for this verification to finish before changing the revision.",
        409,
      );
    const f = selectedFixture(this.fixtures, kind);
    assertFixtures(this.fixtures);
    this.invalidate(
      p,
      "Candidate selection changed; previous approval and evidence do not apply.",
    );
    this.db
      .prepare(
        "UPDATE proposals SET kind=?,candidate_revision=?,diff=?,explanation=?,revision_number=revision_number+1,current_approval=NULL,last_run=NULL,state='Proposal ready',updated_at=? WHERE id=?",
      )
      .run(
        kind,
        f.revision,
        kind === "discount-fix"
          ? this.fixtures.diff
          : "No source changes. Candidate is byte-for-byte identical to the baseline.",
        kind === "discount-fix"
          ? "Developer-authored fixture: record the canonical discounted quote total."
          : "Developer-authored unchanged negative control.",
        now(),
        id,
      );
    this.event(p.ticket_id, id, "Local engineer", "Revision changed", {
      kind,
      revision: f.revision,
    });
    return this.detail(id);
  }
  submit(id: string) {
    const p = this.proposal(id);
    this.checkCurrent(p);
    if (!["Proposal ready", "Changes requested"].includes(p.state))
      problem("Only a ready proposal can be submitted for approval.", 409);
    this.db
      .prepare(
        "UPDATE proposals SET state='Awaiting engineer approval',updated_at=? WHERE id=?",
      )
      .run(now(), id);
    this.event(
      p.ticket_id,
      id,
      "Local engineer",
      "Awaiting engineer approval",
      p.candidate_revision,
    );
    return this.detail(id);
  }
  approve(id: string, revision: string, revisionNumber: number) {
    const p = this.proposal(id);
    this.checkCurrent(p);
    if (
      p.state !== "Awaiting engineer approval" ||
      p.candidate_revision !== revision ||
      p.revision_number !== revisionNumber
    )
      problem(
        "This exact revision is not awaiting approval. Refresh and review it again.",
        409,
      );
    const idApproval = randomUUID(),
      timestamp = now();
    this.db
      .prepare("INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(
        idApproval,
        id,
        "Local engineer",
        p.candidate_revision,
        p.base_revision,
        p.requirements_hash,
        p.harness_hash,
        p.revision_number,
        timestamp,
        null,
      );
    this.db
      .prepare(
        "UPDATE proposals SET current_approval=?,state='Approved for testing',updated_at=? WHERE id=?",
      )
      .run(idApproval, timestamp, id);
    this.event(p.ticket_id, id, "Local engineer", "Approved for testing", {
      approval: idApproval,
      revision: p.candidate_revision,
    });
    return this.detail(id);
  }
  decision(id: string, action: "changes" | "reject", note: string) {
    const p = this.proposal(id);
    if (p.state === "Verification running")
      problem("Verification is running; review it after completion.", 409);
    this.invalidate(p, note || action);
    const state = action === "reject" ? "Rejected" : "Changes requested";
    this.db
      .prepare("UPDATE proposals SET state=?,updated_at=? WHERE id=?")
      .run(state, now(), id);
    this.event(p.ticket_id, id, "Local engineer", state, note);
    return this.detail(id);
  }
  approvalFor(p: any) {
    this.checkCurrent(p);
    const a = this.db
      .prepare("SELECT * FROM approvals WHERE id=? AND invalidated_at IS NULL")
      .get(p.current_approval ?? "") as any;
    if (
      !a ||
      a.revision !== p.candidate_revision ||
      a.revision_number !== p.revision_number ||
      a.base_revision !== p.base_revision ||
      a.harness_hash !== p.harness_hash ||
      a.requirements_hash !== p.requirements_hash
    )
      problem(
        "Engineer approval of this exact revision is required before verification.",
        403,
      );
    if (
      ![
        "Approved for testing",
        "Failed",
        "Inconclusive",
        "Verified awaiting engineer review",
      ].includes(p.state)
    )
      problem("Proposal is not available for verification.", 409);
    return a;
  }
  detail(id: string) {
    const p = this.proposal(id);
    const ticket = this.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .get(p.ticket_id);
    const approvals = this.db
      .prepare(
        "SELECT * FROM approvals WHERE proposal_id=? ORDER BY created_at",
      )
      .all(id);
    const runs = this.db
      .prepare(
        "SELECT * FROM runs WHERE proposal_id=? ORDER BY started_at DESC",
      )
      .all(id)
      .map((r: any) => ({
        ...r,
        evidence: r.evidence ? JSON.parse(r.evidence) : null,
      }));
    return {
      ...p,
      requirements: JSON.parse(p.requirements),
      ticket,
      approvals,
      runs,
      activity: this.db
        .prepare("SELECT * FROM activity WHERE ticket_id=? ORDER BY id DESC")
        .all(p.ticket_id),
      knownUnresolved: [
        "Paid order missing from order history",
        "Uploaded listing photo does not persist",
      ],
      author:
        p.kind === "agent-generated"
          ? "Agent-generated"
          : "Developer-authored sample",
      investigation:
        p.kind === "agent-generated" ? this.agentCandidate(id).run_id : null,
      agentMetadata:
        p.kind === "agent-generated"
          ? JSON.parse(this.agentCandidate(id).evidence)
          : null,
      execution: "Scripted Playwright verification",
    };
  }
  list() {
    return this.db
      .prepare(
        "SELECT p.*,t.subject,t.customer_name FROM proposals p JOIN tickets t ON t.id=p.ticket_id ORDER BY p.created_at DESC",
      )
      .all()
      .map((p: any) => ({ ...p, requirements: JSON.parse(p.requirements) }));
  }
  agentCandidate(id: string): any {
    const c = this.db
      .prepare("SELECT * FROM agent_candidates WHERE proposal_id=?")
      .get(id) as any;
    if (!c || !/^[a-f0-9-]{36}$/.test(c.run_id))
      problem("Agent candidate not found.", 409);
    const root = path.join(this.dataDir, "investigations", c.run_id);
    if (
      c.base_root !== path.join(root, "baseline") ||
      c.candidate_root !== path.join(root, "candidate")
    )
      problem("Agent candidate location does not match its run.", 409);
    return c;
  }
  close() {
    this.db.close();
  }
}
