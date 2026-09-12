import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import { chromium } from "@playwright/test";
import { Codex } from "@openai/codex-sdk";
new Codex({
  env: {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp",
    CODEX_HOME: "/tmp/codex",
  },
});
if (process.getuid() === 0) throw new Error("Non-root execution required");
if (Object.keys(os.networkInterfaces()).some((n) => n !== "lo"))
  throw new Error("Network isolation required");
for (const name of [
  "/control/private/engineer-key.json",
  "/control/data/local/controller.sqlite",
  "/operator/BUGS.md",
  "/var/run/docker.sock",
  "/host",
  "/root/.codex/auth.json",
])
  if (fs.existsSync(name)) throw new Error("Protected resource visible");
let denied = false;
try {
  fs.writeFileSync("/opt/runtime/forbidden", "probe");
} catch {
  denied = true;
}
if (!denied) throw new Error("Runtime must be read-only");
await new Promise((resolve, reject) => {
  const s = net.connect({ host: "1.1.1.1", port: 443 });
  s.once("connect", () => {
    s.destroy();
    reject(new Error("External network allowed"));
  });
  s.once("error", resolve);
  s.setTimeout(1500, () => {
    s.destroy();
    resolve();
  });
});
const browser = await chromium.launch({ headless: true });
await browser.close();
console.log(
  JSON.stringify({
    isolated: true,
    browser: true,
    uid: process.getuid(),
    externalNetwork: false,
    protectedFiles: false,
  }),
);
