import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
export default class EvidenceReporter implements Reporter {
  started = new Date().toISOString();
  tests: any[] = [];
  errors: string[] = [];
  onError(error: any) {
    this.errors.push(error.message || String(error));
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const observation = result.attachments.find(
      (a) => a.name === "observation",
    );
    let values = null;
    try {
      if (observation)
        values = JSON.parse(
          observation.body?.toString() ??
            readFileSync(observation.path!, "utf8"),
        );
    } catch {}
    const id =
      test.title.match(/^D\d+/)?.[0] ||
      (test.title.startsWith("history:")
        ? "K01"
        : test.title.startsWith("photo:")
          ? "K02"
          : "unknown");
    this.tests.push({
      id,
      title: test.title,
      playwrightTestId: test.id,
      status: result.status,
      expectedStatus: test.expectedStatus,
      retry: result.retry,
      startedAt: result.startTime.toISOString(),
      durationMs: result.duration,
      observation: values,
      errors: result.errors.map((e) => e.message),
      artifacts: result.attachments
        .filter((a) => a.path)
        .map((a) => ({
          name: a.name,
          type: a.contentType,
          path: path
            .relative(process.env.TWO_DB_EVIDENCE_DIR!, a.path!)
            .replaceAll("\\", "/"),
        })),
    });
  }
  onEnd(result: FullResult) {
    writeFileSync(
      path.join(process.env.TWO_DB_EVIDENCE_DIR!, "results.json"),
      JSON.stringify(
        {
          runId: process.env.TWO_DB_RUN_ID,
          revision: process.env.TWO_DB_REVISION,
          harness: process.env.TWO_DB_HARNESS,
          startedAt: this.started,
          finishedAt: new Date().toISOString(),
          status: result.status,
          errors: this.errors,
          tests: this.tests,
        },
        null,
        2,
      ),
    );
  }
}
