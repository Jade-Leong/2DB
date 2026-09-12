import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { projectRoot } from "./paths";
const appRoot = process.env.TWO_DB_APP_ROOT;
const evidenceDir = process.env.TWO_DB_EVIDENCE_DIR;
if (!appRoot || !evidenceDir)
  throw new Error(
    "Use the controller runner; an isolated app and evidence directory are required.",
  );
export default defineConfig({
  testDir: path.join(projectRoot, "verification"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 5000 },
  outputDir: path.join(evidenceDir, "artifacts"),
  reporter: [["list"], [path.join(projectRoot, "control/reporter.ts")]],
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "required", testMatch: "control-discount.spec.ts" },
    {
      name: "known-unresolved",
      testMatch: "acceptance.spec.ts",
      grep: /history:|photo:/,
    },
  ],
  webServer: {
    command: `"${process.execPath}" "${path.join(projectRoot, "node_modules/tsx/dist/cli.mjs")}" server/index.ts`,
    cwd: appRoot,
    url: "http://127.0.0.1:3001/api/health",
    reuseExistingServer: false,
    env: { LOOP_TEST: "1" },
    timeout: 30000,
  },
});
