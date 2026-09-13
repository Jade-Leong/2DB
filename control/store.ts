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
  remoteTickets?: () => Promise<any[]>;
  remoteDeleteTicket?: (id: string) => Promise<boolean>;
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
   CREATE TABLE IF NOT EXISTS approved_queue(proposal_id TEXT PRIMARY KEY REFERENCES proposals(id), reviewer TEXT NOT NULL, revision TEXT NOT NULL, revision_number INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL REFERENCES proposals(id), approval_id TEXT NOT NULL, candidate_revision TEXT NOT NULL, base_revision TEXT NOT NULL, requirements_hash TEXT NOT NULL, harness_hash TEXT NOT NULL, revision_number INTEGER NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, evidence TEXT, message TEXT);
   CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,ticket_id TEXT NOT NULL,proposal_id TEXT,actor TEXT NOT NULL,event TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS ticket_requests(request_id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id));
   CREATE TABLE IF NOT EXISTS github_links(reviewer TEXT PRIMARY KEY, github_user_id INTEGER NOT NULL, github_login TEXT NOT NULL, user_token TEXT NOT NULL, user_token_expires_at TEXT, refresh_token TEXT, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS github_prs(proposal_id TEXT PRIMARY KEY REFERENCES proposals(id), pr_url TEXT NOT NULL, pr_number INTEGER NOT NULL, head_branch TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL, created_at TEXT NOT NULL);`);
    this.ensureColumn(
      "proposals",
      "investigation_origin",
      "TEXT NOT NULL DEFAULT 'developer-fixture'",
    );
    this.ensureColumn(
      "runs",
      "verification_mode",
      "TEXT NOT NULL DEFAULT 'scripted-verification'",
    );
    this.ensureColumn("runs", "agent_assessment", "TEXT");
    this.ensureColumn("tickets", "source", "TEXT NOT NULL DEFAULT 'marketplace'");
    const interrupted = this.db
      .prepare(
        "SELECT * FROM runs WHERE state IN ('Verification running','Live Agent 2 running')",
      )
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
  private ensureColumn(table: string, name: string, definition: string) {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as any[];
    if (!columns.some((column) => column.name === name))
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  inbox(): any[] {
    let external: any[] = [];
    if (existsSync(this.ticketSource)) {
      const source = new DatabaseSync(this.ticketSource, { readOnly: true });
      try {
        source.exec("PRAGMA query_only=ON");
        external = source
        .prepare(
          "SELECT t.id,t.account_id AS customer_id,a.name AS customer_name,a.role AS customer_role,t.subject,t.message AS complaint,t.created_at AS submitted_at FROM support_tickets t JOIN accounts a ON a.id=t.account_id ORDER BY t.created_at DESC",
        )
        .all();
      } finally { source.close(); }
    }
    return this.mergeControllerTickets(external).map((t) => ({
          ...t,
          related_reference: t.related_reference ?? null,
          imported: !!this.db
            .prepare("SELECT id FROM tickets WHERE id=?")
            .get(t.id),
        }));
  }
  private mergeControllerTickets(external: any[]) {
    const local = this.db.prepare("SELECT id,customer_id,customer_name,customer_role,subject,complaint,submitted_at,related_reference,source FROM tickets").all() as any[];
    const rows = new Map<string, any>(external.map((t) => [t.id, t]));
    for (const t of local) if (!rows.has(t.id)) rows.set(t.id, t);
    return [...rows.values()].sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
  }
  async inboxAsync(): Promise<any[]> {
    if (!this.remoteTickets) return this.inbox();
    return this.mergeControllerTickets(await this.remoteTickets()).map((t) => ({
      ...t,
      related_reference: t.related_reference ?? null,
      imported: !!this.db
        .prepare("SELECT id FROM tickets WHERE id=?")
        .get(t.id),
    }));
  }
  async deleteTicket(id: string) {
    const proposal = this.db
      .prepare("SELECT id FROM proposals WHERE ticket_id=? LIMIT 1")
      .get(id);
    if (proposal)
      problem("This ticket has proposals attached and cannot be deleted.", 409);
    if (this.remoteTickets) {
      if (!this.remoteDeleteTicket)
        problem("Deleting remote marketplace tickets is not supported.", 501);
      const ok = await this.remoteDeleteTicket(id);
      if (!ok) problem("Marketplace ticket not found.", 404);
    } else {
      if (!existsSync(this.ticketSource))
        problem("Marketplace ticket not found.", 404);
      const source = new DatabaseSync(this.ticketSource);
      try {
        const existing = source
          .prepare("SELECT id FROM support_tickets WHERE id=?")
          .get(id);
        if (!existing) problem("Marketplace ticket not found.", 404);
        source.prepare("DELETE FROM support_tickets WHERE id=?").run(id);
      } finally {
        source.close();
      }
    }
    this.db.prepare("DELETE FROM activity WHERE ticket_id=?").run(id);
    this.db.prepare("DELETE FROM tickets WHERE id=?").run(id);
    return { id, deleted: true };
  }
  async receiveTicket(id: string) {
    if (!this.remoteTickets) return this.importTicket(id);
    const existing = this.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .get(id);
    if (existing) return existing;
    const t = (await this.inboxAsync()).find((t) => t.id === id);
    if (!t) problem("Submitted marketplace ticket not found.", 404);
    return this.saveTicket(t);
  }
  importTicket(id: string) {
    const existing = this.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .get(id);
    if (existing) return existing;
    const t = this.inbox().find((t) => t.id === id);
    if (!t) problem("Submitted marketplace ticket not found.", 404);
    return this.saveTicket(t);
  }
  private saveTicket(t: any) {
    const existing = this.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .get(t.id);
    if (existing) return existing;
    const id = t.id;
    this.db
      .prepare("INSERT INTO tickets(id,customer_id,customer_name,customer_role,subject,complaint,submitted_at,related_reference,imported_at,source) VALUES(?,?,?,?,?,?,?,?,?,?)")
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
        t.source ?? "marketplace",
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
  create(
    ticketId: string,
    kind: FixtureKind,
    investigationOrigin = "developer-fixture",
  ) {
    this.importTicket(ticketId);
    assertFixtures(this.fixtures);
    const f = selectedFixture(this.fixtures, kind),
      id = randomUUID(),
      timestamp = now(),
      requirements = JSON.stringify(discountRequirements);
    this.db
      .prepare(
        "INSERT INTO proposals(id,ticket_id,kind,base_revision,candidate_revision,requirements,requirements_hash,harness_hash,diff,explanation,state,revision_number,current_approval,last_run,created_at,updated_at,investigation_origin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
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
        investigationOrigin,
      );
    const actor =
      investigationOrigin === "scripted-agent-1"
        ? "Scripted investigation"
        : "Developer-authored fixture";
    this.event(ticketId, id, actor, "Proposal ready", {
      kind,
      revision: f.revision,
      investigationOrigin,
    });
    return this.detail(id);
  }
  invalidate(p: any, message: string) {
    this.db
      .prepare(
        "UPDATE approvals SET invalidated_at=? WHERE proposal_id=? AND invalidated_at IS NULL",
      )
      .run(now(), p.id);
    this.db.prepare("DELETE FROM approved_queue WHERE proposal_id=?").run(p.id);
    this.db
      .prepare(
        "UPDATE proposals SET current_approval=NULL,state='Changes requested',updated_at=? WHERE id=?",
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
  submit(id: string, reviewer = "Local engineer") {
    const p = this.proposal(id);
    this.checkCurrent(p);
    if (!["Proposal ready", "Changes requested"].includes(p.state))
      problem("Only a ready proposal can be submitted for approval.", 409);
    this.db
      .prepare(
        "UPDATE proposals SET state='Ready for Agent 2',updated_at=? WHERE id=?",
      )
      .run(now(), id);
    this.event(
      p.ticket_id,
      id,
      reviewer,
      "Ready for Agent 2",
      p.candidate_revision,
    );
    return this.detail(id);
  }
  authorizeVerification(id: string) {
    const p = this.proposal(id);
    this.checkCurrent(p);
    if (
      ![
        "Proposal ready",
        "Ready for Agent 2",
        "Awaiting engineer approval",
        "Changes requested",
      ].includes(p.state)
    )
      problem("This proposal is not ready for independent verification.", 409);
    const idApproval = randomUUID(),
      timestamp = now();
    this.db
      .prepare("INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(
        idApproval,
        id,
        "Controller verification authorization",
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
        "UPDATE proposals SET current_approval=?,state='Authorized for verification',updated_at=? WHERE id=?",
      )
      .run(idApproval, timestamp, id);
    this.event(
      p.ticket_id,
      id,
      "Controller",
      "Authorized for Agent 2 verification",
      {
        approval: idApproval,
        revision: p.candidate_revision,
      },
    );
    return this.detail(id);
  }
  approve(
    id: string,
    revision: string,
    revisionNumber: number,
    reviewer = "Local engineer",
  ) {
    const p = this.proposal(id);
    this.checkCurrent(p);
    if (
      !["Verified awaiting engineer review", "Failed", "Inconclusive"].includes(
        p.state,
      ) ||
      p.candidate_revision !== revision ||
      p.revision_number !== revisionNumber
    )
      problem(
        "A completed live Agent 2 review of this exact revision is required before approval.",
        409,
      );
    const authorization = this.approvalFor(p);
    const run = this.db
      .prepare("SELECT * FROM runs WHERE id=?")
      .get(p.last_run ?? "") as any;
    if (
      !run ||
      !["Verified awaiting engineer review", "Failed", "Inconclusive"].includes(
        run.state,
      ) ||
      !run.finished_at ||
      run.verification_mode !== "live-agent-2" ||
      run.approval_id !== authorization.id ||
      run.candidate_revision !== p.candidate_revision ||
      run.base_revision !== p.base_revision ||
      run.requirements_hash !== p.requirements_hash ||
      run.harness_hash !== p.harness_hash ||
      run.revision_number !== p.revision_number
    )
      problem(
        "A completed live Agent 2 review of this exact revision is required before approval.",
        409,
      );
    const timestamp = now();
    this.db
      .prepare(
        "INSERT INTO approved_queue VALUES(?,?,?,?,?) ON CONFLICT(proposal_id) DO NOTHING",
      )
      .run(id, reviewer, p.candidate_revision, p.revision_number, timestamp);
    this.db
      .prepare("UPDATE proposals SET state='Approved',updated_at=? WHERE id=?")
      .run(timestamp, id);
    this.event(p.ticket_id, id, reviewer, "Added to Approved queue", {
      revision: p.candidate_revision,
      revisionNumber: p.revision_number,
      purpose: "Human engineer PR preparation",
    });
    return this.detail(id);
  }
  decision(
    id: string,
    action: "changes" | "reject",
    note: string,
    reviewer = "Local engineer",
  ) {
    const p = this.proposal(id);
    if (p.state === "Verification running")
      problem("Verification is running; review it after completion.", 409);
    this.invalidate(p, note || action);
    const state = action === "reject" ? "Rejected" : "Changes requested";
    this.db
      .prepare("UPDATE proposals SET state=?,updated_at=? WHERE id=?")
      .run(state, now(), id);
    this.event(p.ticket_id, id, reviewer, state, note);
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
        "Controller authorization of this exact revision is required before verification.",
        403,
      );
    if (
      ![
        "Authorized for verification",
        "Live Agent 2 running",
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
      queueApproval:
        this.db
          .prepare("SELECT * FROM approved_queue WHERE proposal_id=?")
          .get(id) || null,
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
          : p.investigation_origin === "scripted-agent-1"
            ? "Scripted investigation + developer-authored proposal"
            : "Developer-authored sample",
      investigationOrigin:
        p.kind === "agent-generated" ||
        p.investigation_origin === "live-agent-1"
          ? "Live Agent 1"
          : p.investigation_origin === "scripted-agent-1"
            ? "Scripted investigation + developer-authored proposal"
            : "Developer-authored fixture",
      investigation:
        p.kind === "agent-generated" ? this.agentCandidate(id).run_id : null,
      agentMetadata:
        p.kind === "agent-generated"
          ? JSON.parse(this.agentCandidate(id).evidence)
          : null,
      execution:
        runs[0]?.verification_mode === "live-agent-2"
          ? "Live Agent 2 + mandatory scripted verification"
          : "Scripted verification only",
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
  githubLink(reviewer: string): { github_user_id: number; github_login: string; user_token: string; user_token_expires_at: string | null; refresh_token: string | null } | undefined {
    return this.db.prepare("SELECT github_user_id, github_login, user_token, user_token_expires_at, refresh_token FROM github_links WHERE reviewer=?").get(reviewer) as any;
  }
  saveGithubLink(reviewer: string, link: { github_user_id: number; github_login: string; user_token: string; user_token_expires_at?: string | null; refresh_token?: string | null }) {
    this.db.prepare("INSERT INTO github_links(reviewer,github_user_id,github_login,user_token,user_token_expires_at,refresh_token,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(reviewer) DO UPDATE SET github_user_id=excluded.github_user_id, github_login=excluded.github_login, user_token=excluded.user_token, user_token_expires_at=excluded.user_token_expires_at, refresh_token=excluded.refresh_token").run(
      reviewer, link.github_user_id, link.github_login, link.user_token, link.user_token_expires_at ?? null, link.refresh_token ?? null, now(),
    );
  }
  removeGithubLink(reviewer: string) {
    this.db.prepare("DELETE FROM github_links WHERE reviewer=?").run(reviewer);
  }
  savePr(proposalId: string, pr: { url: string; number: number; branch: string; owner: string; repo: string }) {
    this.db.prepare("INSERT INTO github_prs(proposal_id,pr_url,pr_number,head_branch,owner,repo,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(proposal_id) DO UPDATE SET pr_url=excluded.pr_url, pr_number=excluded.pr_number, head_branch=excluded.head_branch, owner=excluded.owner, repo=excluded.repo").run(
      proposalId, pr.url, pr.number, pr.branch, pr.owner, pr.repo, now(),
    );
  }
  prForProposal(proposalId: string): { pr_url: string; pr_number: number; head_branch: string; owner: string; repo: string } | undefined {
    return this.db.prepare("SELECT pr_url, pr_number, head_branch, owner, repo FROM github_prs WHERE proposal_id=?").get(proposalId) as any;
  }
  close() {
    this.db.close();
  }
}
