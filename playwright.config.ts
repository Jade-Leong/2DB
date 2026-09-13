import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./verification",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "support", testMatch: "support.spec.ts" },
    { name: "smoke", testMatch: "smoke.spec.ts" },
    { name: "acceptance", testMatch: "acceptance.spec.ts" },
  ],
  webServer: {
    command:
      process.platform === "win32" ? "npm.cmd run start" : "npm run start",
    url: "http://127.0.0.1:3001/api/health",
    reuseExistingServer: false,
    env: { LOOP_TEST: "1", ELEVENLABS_API_KEY: "", ELEVENLABS_AGENT_ID: "" },
    timeout: 30000,
  },
});
