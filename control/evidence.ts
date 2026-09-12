import { isDeepStrictEqual } from "node:util";
import { discountRequirements } from "../verification/discount-contract";
export type EvidenceIdentity = {
  runId: string;
  revision: string;
  harness: string;
};
function knownComplete(environment: any, identity: EvidenceIdentity) {
  const known = environment?.known,
    report = known?.report;
  return (
    environment?.typecheck?.exitCode === 0 &&
    environment?.build?.exitCode === 0 &&
    [0, 1].includes(known?.exitCode) &&
    report?.runId === identity.runId &&
    report?.revision === identity.revision &&
    report?.harness === identity.harness &&
    !report?.errors?.length &&
    report?.tests?.length === 2 &&
    ["K01", "K02"].every((id) => {
      const tests = report.tests.filter((t: any) => t.id === id);
      return (
        tests.length === 1 &&
        tests[0].expectedStatus === "passed" &&
        tests[0].retry === 0 &&
        (tests[0].status === "passed" ||
          (tests[0].status === "failed" &&
            tests[0].errors?.length &&
            tests[0].errors.every((e: string) => e.includes("expect("))))
      );
    })
  );
}
export function assessRequired(
  report: any,
  exitCode: number | null,
  identity: EvidenceIdentity,
) {
  const matching =
    !!report &&
    report.runId === identity.runId &&
    report.revision === identity.revision &&
    report.harness === identity.harness &&
    Array.isArray(report.tests);
  const checks = discountRequirements.map((r) => {
    const matches = matching
      ? report.tests.filter((t: any) => t.id === r.id)
      : [];
    const t = matches[0];
    let status = "missing";
    if (matches.length !== 1)
      status = matches.length ? "inconclusive" : "missing";
    else if (
      t.status === "timedOut" ||
      t.status === "interrupted" ||
      t.status === "skipped" ||
      t.expectedStatus !== "passed" ||
      t.retry !== 0 ||
      !t.observation ||
      t.observation.id !== r.id ||
      !isDeepStrictEqual(t.observation.expected, r.expected)
    )
      status = "inconclusive";
    else if (
      t.status === "passed" &&
      !t.errors?.length &&
      isDeepStrictEqual(t.observation.observed, r.expected)
    )
      status = "passed";
    else status = "failed";
    return {
      id: r.id,
      title: r.title,
      expected: r.expected,
      observed: t?.observation?.observed ?? null,
      status,
      errors: t?.errors ?? [],
      artifacts: t?.artifacts ?? [],
      startedAt: t?.startedAt ?? null,
      durationMs: t?.durationMs ?? null,
      playwrightTestId: t?.playwrightTestId ?? null,
    };
  });
  const unexpected =
    matching &&
    report.tests.some(
      (t: any) => !discountRequirements.some((r) => r.id === t.id),
    );
  const incomplete =
    !matching ||
    unexpected ||
    report?.errors?.length ||
    checks.some((c) => ["missing", "inconclusive"].includes(c.status));
  const allPassed =
    checks.every((c) => c.status === "passed") &&
    matching &&
    !unexpected &&
    !report?.errors?.length &&
    exitCode === 0 &&
    report.status === "passed";
  return {
    status: allPassed
      ? "passed"
      : incomplete ||
          exitCode === null ||
          (exitCode !== 0 && checks.every((c) => c.status === "passed"))
        ? "inconclusive"
        : "failed",
    exitCode,
    checks,
    identityMatches: matching,
  };
}
export function finalDecision(
  proposal: any,
  approval: any,
  run: any,
  evidence: any,
) {
  if (
    !approval ||
    approval.invalidated_at ||
    proposal.current_approval !== approval.id ||
    run.approval_id !== approval.id ||
    run.revision_number !== proposal.revision_number ||
    approval.revision_number !== proposal.revision_number ||
    run.candidate_revision !== proposal.candidate_revision ||
    approval.revision !== proposal.candidate_revision ||
    run.base_revision !== proposal.base_revision ||
    approval.base_revision !== proposal.base_revision ||
    approval.harness_hash !== proposal.harness_hash ||
    approval.requirements_hash !== proposal.requirements_hash ||
    run.harness_hash !== proposal.harness_hash ||
    run.requirements_hash !== proposal.requirements_hash
  )
    return "Inconclusive";
  if (
    !evidence?.baseline?.required ||
    !evidence?.candidate?.required ||
    !evidence.integrityVerified
  )
    return "Inconclusive";
  if (
    !knownComplete(evidence.baseline, {
      runId: run.id,
      revision: run.base_revision,
      harness: run.harness_hash,
    }) ||
    !knownComplete(evidence.candidate, {
      runId: run.id,
      revision: run.candidate_revision,
      harness: run.harness_hash,
    })
  )
    return "Inconclusive";
  const base = assessRequired(
    evidence.baseline.required.report,
    evidence.baseline.required.exitCode,
    { runId: run.id, revision: run.base_revision, harness: run.harness_hash },
  );
  const candidate = assessRequired(
    evidence.candidate.required.report,
    evidence.candidate.required.exitCode,
    {
      runId: run.id,
      revision: run.candidate_revision,
      harness: run.harness_hash,
    },
  );
  if (base.status === "inconclusive" || candidate.status === "inconclusive")
    return "Inconclusive";
  if (candidate.status === "failed") return "Failed";
  if (
    base.status !== "failed" ||
    !base.checks.some((c) => c.id === "D01" && c.status === "failed")
  )
    return "Inconclusive";
  return "Verified awaiting engineer review";
}
