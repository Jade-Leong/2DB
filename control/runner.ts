import { spawn } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { projectRoot, now, problem } from "./paths";
import {
  copySnapshot,
  revision,
  selectedFixture,
  assertFixtures,
  harnessRevision,
} from "./snapshots";
import { assessRequired, finalDecision } from "./evidence";
import { Store } from "./store";

export const occupiedMessage =
  "Stop Loop Market with Ctrl+C, then retry verification.";
export async function portAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
function childEnvironment(extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PROGRAMFILES",
    "ProgramFiles",
    "PROGRAMFILES(X86)",
    "NUMBER_OF_PROCESSORS",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return { ...env, CI: "1", LOOP_TEST: "1", ...extra };
}
async function execute(
  args: string[],
  cwd: string,
  logPath: string,
  extra: Record<string, string> = {},
  timeoutMs = 240000,
): Promise<any> {
  const startedAt = now();
  const output = openSync(logPath, "w");
  return new Promise((resolve) => {
    let timedOut = false,
      settled = false;
    const child = spawn(process.execPath, args, {
      cwd,
      env: childEnvironment(extra),
      stdio: ["ignore", output, output],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        if (process.platform === "win32")
          spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        else child.kill("SIGTERM");
      }
    }, timeoutMs);
    const finish = (exitCode: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSync(output);
      resolve({
        exitCode,
        timedOut,
        error: error ?? null,
        startedAt,
        finishedAt: now(),
        log: path.basename(logPath),
      });
    };
    child.once("error", (e) => finish(null, e.message));
    child.once("close", (code) =>
      finish(
        timedOut ? null : code,
        timedOut ? "Trusted verification process timed out." : undefined,
      ),
    );
  });
}
export class Runner {
  active = false;
  constructor(public store: Store) {}
  async start(proposalId: string) {
    if (this.active)
      problem(
        "A sequential verification is already running. Wait for it to finish.",
        409,
      );
    const p = this.store.proposal(proposalId),
      approval = this.store.approvalFor(p);
    this.active = true;
    if (!(await portAvailable(3001))) {
      this.active = false;
      this.store.event(
        p.ticket_id,
        p.id,
        "Controller",
        "Verification blocked",
        occupiedMessage,
      );
      problem(occupiedMessage, 409);
    }
    // Check again after the asynchronous port probe: the approval must still be current.
    const fresh = this.store.proposal(proposalId);
    try {
      const current = this.store.approvalFor(fresh);
      if (current.id !== approval.id)
        problem("Approval changed. Review this revision again.", 409);
    } catch (e) {
      this.active = false;
      throw e;
    }
    const runId = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO runs(id,proposal_id,approval_id,candidate_revision,base_revision,requirements_hash,harness_hash,revision_number,state,started_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        runId,
        p.id,
        approval.id,
        p.candidate_revision,
        p.base_revision,
        p.requirements_hash,
        p.harness_hash,
        p.revision_number,
        "Verification running",
        now(),
      );
    this.store.db
      .prepare(
        "UPDATE proposals SET state='Verification running',last_run=?,updated_at=? WHERE id=?",
      )
      .run(runId, now(), p.id);
    this.store.event(
      p.ticket_id,
      p.id,
      "Scripted verification",
      "Verification running",
      { runId, approval: approval.id, revision: p.candidate_revision },
    );
    void this.perform(runId)
      .catch((error) => {
        this.store.db
          .prepare(
            "UPDATE runs SET state='Inconclusive',finished_at=?,message=? WHERE id=?",
          )
          .run(now(), String(error.message), runId);
        this.store.db
          .prepare(
            "UPDATE proposals SET state='Inconclusive',updated_at=? WHERE id=?",
          )
          .run(now(), p.id);
        this.store.event(
          p.ticket_id,
          p.id,
          "Scripted verification",
          "Inconclusive",
          String(error.message),
        );
      })
      .finally(() => {
        this.active = false;
      });
    return { runId, state: "Verification running" };
  }
  async environment(
    run: any,
    label: "baseline" | "candidate",
    source: string,
    expectedRevision: string,
  ) {
    const root = path.join(this.store.dataDir, "workspaces", run.id, label),
      evidenceRoot = path.join(this.store.dataDir, "runs", run.id, label);
    copySnapshot(source, root);
    mkdirSync(evidenceRoot, { recursive: true });
    if (revision(root) !== expectedRevision)
      throw new Error("Application copy does not match the approved snapshot.");
    const typecheck = await execute(
      [path.join(projectRoot, "node_modules/typescript/bin/tsc"), "--noEmit"],
      root,
      path.join(evidenceRoot, "typecheck.log"),
    );
    const build =
      typecheck.exitCode === 0
        ? await execute(
            [path.join(projectRoot, "node_modules/vite/bin/vite.js"), "build"],
            root,
            path.join(evidenceRoot, "build.log"),
          )
        : { exitCode: null, error: "Typecheck failed; build not started." };
    const result: any = {
      revision: expectedRevision,
      root: path.relative(this.store.dataDir, root).replaceAll("\\", "/"),
      typecheck,
      build,
    };
    for (const project of ["required", "known-unresolved"]) {
      const dir = path.join(evidenceRoot, project);
      mkdirSync(dir, { recursive: true });
      let execution: any = {
        exitCode: null,
        error: "Build failed; tests not started.",
        startedAt: now(),
        finishedAt: now(),
      };
      if (build.exitCode === 0 && typecheck.exitCode === 0) {
        if (!(await portAvailable(3001)))
          execution = { ...execution, error: occupiedMessage };
        else
          execution = await execute(
            [
              path.join(projectRoot, "node_modules/@playwright/test/cli.js"),
              "test",
              "--config",
              path.join(projectRoot, "control/playwright.config.ts"),
              "--project",
              project,
            ],
            root,
            path.join(dir, "process.log"),
            {
              TWO_DB_APP_ROOT: root,
              TWO_DB_EVIDENCE_DIR: dir,
              TWO_DB_RUN_ID: run.id,
              TWO_DB_REVISION: expectedRevision,
              TWO_DB_HARNESS: run.harness_hash,
            },
            360000,
          );
      }
      let report = null;
      try {
        report = JSON.parse(
          readFileSync(path.join(dir, "results.json"), "utf8"),
        );
      } catch {}
      result[project === "required" ? "required" : "known"] = {
        ...execution,
        report,
      };
      if (project === "required")
        result.required.assessment = assessRequired(
          report,
          execution.exitCode,
          {
            runId: run.id,
            revision: expectedRevision,
            harness: run.harness_hash,
          },
        );
      this.store.event(
        this.store.proposal(run.proposal_id).ticket_id,
        run.proposal_id,
        "Scripted verification",
        `${label} ${project} finished`,
        {
          runId: run.id,
          exitCode: execution.exitCode,
          status: result.required?.assessment?.status,
        },
      );
    }
    result.sourceUnchanged = revision(root) === expectedRevision;
    writeFileSync(
      path.join(evidenceRoot, "summary.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  }
  async perform(id: string) {
    const run = this.store.db
        .prepare("SELECT * FROM runs WHERE id=?")
        .get(id) as any,
      p = this.store.proposal(run.proposal_id),
      f = selectedFixture(this.store.fixtures, p.kind);
    const evidence: any = { integrityVerified: false };
    assertFixtures(this.store.fixtures);
    evidence.baseline = await this.environment(
      run,
      "baseline",
      this.store.fixtures.base.root,
      run.base_revision,
    );
    // Always use a new copy and database, even for the unchanged negative control.
    evidence.candidate = await this.environment(
      run,
      "candidate",
      f.root,
      run.candidate_revision,
    );
    assertFixtures(this.store.fixtures);
    evidence.integrityVerified =
      evidence.baseline.sourceUnchanged &&
      evidence.candidate.sourceUnchanged &&
      harnessRevision() === run.harness_hash;
    const current = this.store.proposal(p.id),
      approval = this.store.db
        .prepare("SELECT * FROM approvals WHERE id=?")
        .get(run.approval_id);
    const state = finalDecision(current, approval, run, evidence),
      message =
        state === "Verified awaiting engineer review"
          ? "Discount fix verified in local test environment — awaiting engineer review."
          : state === "Failed"
            ? "Required discount checks failed. Approval did not imply a passing result."
            : "Evidence is incomplete, stale, or the baseline did not reproduce the complaint. Review run logs.";
    this.store.db
      .prepare(
        "UPDATE runs SET state=?,finished_at=?,evidence=?,message=? WHERE id=?",
      )
      .run(state, now(), JSON.stringify(evidence), message, id);
    this.store.db
      .prepare("UPDATE proposals SET state=?,updated_at=? WHERE id=?")
      .run(state, now(), p.id);
    this.store.event(p.ticket_id, p.id, "Scripted verification", state, {
      runId: id,
      message,
    });
    writeFileSync(
      path.join(this.store.dataDir, "runs", id, "result.json"),
      JSON.stringify({ runId: id, state, message, evidence }, null, 2),
    );
  }
}
