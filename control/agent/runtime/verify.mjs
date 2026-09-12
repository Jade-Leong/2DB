import { cpSync, mkdirSync, symlinkSync } from "node:fs";
import { spawn } from "node:child_process";
mkdirSync("/tmp/harness", { recursive: true });
cpSync("/trusted", "/tmp/harness", { recursive: true });
symlinkSync("/app/node_modules", "/tmp/harness/node_modules");
mkdirSync("/tmp/evidence", { recursive: true });
const child = spawn(
  process.execPath,
  [
    "/app/node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "/tmp/harness/control/playwright.config.ts",
    "--project",
    process.argv[2],
  ],
  {
    cwd: "/tmp/harness",
    env: {
      ...process.env,
      TWO_DB_ISOLATED: "1",
      TWO_DB_APP_ROOT: "/app",
      TWO_DB_EVIDENCE_DIR: "/tmp/evidence",
      LOOP_TEST: "1",
    },
    stdio: "inherit",
  },
);
child.on("exit", (code) => process.exit(code ?? 2));
