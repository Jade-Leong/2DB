import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { controlRoot, projectRoot } from "../paths";
import { hash, sourceFiles } from "../snapshots";
import { safeFile } from "./policy";

export const agentRoot = path.join(controlRoot, "agent");
export function runtimeHash() {
  return hash(
    JSON.stringify(
      [
        "package.json",
        "package-lock.json",
        "control/agent/Dockerfile",
        ...readdirSync(path.join(agentRoot, "runtime")).map(
          (p) => "control/agent/runtime/" + p,
        ),
      ].map((p) => [p, hash(readFileSync(path.join(projectRoot, p)))]),
    ),
  );
}
export function imageTag() {
  return "twodb-agent:" + runtimeHash().slice(0, 20);
}
export function dockerEnv() {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOME",
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  return env;
}
function localEngine(args: string[]) {
  return [
    "--host",
    process.platform === "win32"
      ? "npipe:////./pipe/dockerDesktopLinuxEngine"
      : "unix:///var/run/docker.sock",
    ...args,
  ];
}
export function hardening(name: string, network = "none") {
  if (
    !/^twodb-[a-z0-9-]+$/.test(name) ||
    !(network === "none" || /^container:twodb-[a-z0-9-]+$/.test(network))
  )
    throw new Error("Invalid isolated resource");
  return [
    "--name",
    name,
    "--label",
    "app=2db-agent",
    "--network",
    network,
    "--read-only",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "2g",
    "--cpus",
    "2",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=512m,uid=1000,gid=1000",
  ];
}
export async function docker(
  args: string[],
  timeout = 30_000,
  signal?: AbortSignal,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", localEngine(args), {
      windowsHide: true,
      env: dockerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let out = "",
      tooLarge = false;
    const timer = setTimeout(() => child.kill(), timeout);
    const chunk = (data: Buffer) => {
      if (out.length + data.length > 2_000_000) {
        tooLarge = true;
        child.kill();
      } else out += data.toString();
    };
    child.stdout.on("data", chunk);
    child.stderr.on("data", chunk);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: tooLarge ? null : code, out });
    });
  });
}
export async function mustDocker(
  args: string[],
  timeout?: number,
  signal?: AbortSignal,
) {
  const result = await docker(args, timeout, signal);
  if (result.code !== 0)
    throw new Error(
      `Isolated container operation failed (${args[0]}). Docker Desktop must be running; see setup guide.`,
    );
  return result.out.trim();
}
export class JsonProcess {
  child: ChildProcessWithoutNullStreams;
  onMessage: (message: any) => void = () => {};
  onFailure: (error: Error) => void = () => {};
  constructor(args: string[]) {
    this.child = spawn("docker", localEngine(args), {
      windowsHide: true,
      env: dockerEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Raw SDK stderr/transcripts never enter dashboard logs.
    this.child.stderr.on("data", () => {});
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        if (line.length > 8_000_000) throw new Error();
        this.onMessage(JSON.parse(line));
      } catch {
        this.onFailure(new Error("Invalid isolated-worker output"));
      }
    });
    this.child.on("error", () =>
      this.onFailure(new Error("Unable to start isolated worker")),
    );
    this.child.on("close", () =>
      this.onFailure(new Error("Isolated worker stopped")),
    );
    this.child.stdin.on("error", () => {});
  }
  send(message: unknown) {
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
}
export async function prepareImage() {
  const root = path.join(controlRoot, "data/agent-build", randomUUID());
  mkdirSync(root, { recursive: true });
  for (const name of ["package.json", "package-lock.json"])
    cpSync(path.join(projectRoot, name), path.join(root, name));
  cpSync(path.join(agentRoot, "Dockerfile"), path.join(root, "Dockerfile"));
  cpSync(path.join(agentRoot, "runtime"), path.join(root, "runtime"), {
    recursive: true,
  });
  // This context contains installed-tool recipes only; no application, fixtures, notes, or secrets.
  const build = await docker(["build", "--tag", imageTag(), root], 900_000);
  writeFileSync(path.join(root, "build.log"), build.out);
  if (build.code !== 0)
    throw new Error(
      `Image build failed; local log: ${path.join(root, "build.log")}`,
    );
  return imageTag();
}
export async function probeIsolation() {
  const server = await docker(["info", "--format", "{{.OSType}}"], 8000).catch(
    () => null,
  );
  if (server?.code !== 0 || server.out.trim() !== "linux")
    return {
      ready: false,
      browser: false,
      message:
        "Start Docker Desktop with its Linux engine, then run npm.cmd run control:agent:prepare.",
    };
  const image = await docker(
    ["image", "inspect", imageTag(), "--format", "{{.Id}}"],
    8000,
  );
  if (image.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image.out.trim()))
    return {
      ready: false,
      browser: false,
      message:
        "Isolated image is missing or outdated. Run npm.cmd run control:agent:prepare.",
    };
  const name = "twodb-probe-" + randomUUID();
  try {
    const result = await docker(
      [
        "run",
        "--rm",
        ...hardening(name),
        image.out.trim(),
        "node",
        "/opt/runtime/probe.mjs",
      ],
      25_000,
    );
    const observed = JSON.parse(result.out.trim());
    if (
      result.code !== 0 ||
      observed.isolated !== true ||
      observed.browser !== true
    )
      throw new Error();
    return {
      ready: true,
      browser: true,
      image: image.out.trim(),
      message:
        "Non-root, read-only, network-none container and Chromium probe passed.",
    };
  } catch {
    return {
      ready: false,
      browser: false,
      message:
        "Container/Chromium isolation probe failed. Run npm.cmd run control:agent:prepare and inspect Docker Desktop. Unsafe execution remains disabled.",
    };
  } finally {
    await docker(["rm", "-f", name]).catch(() => {});
  }
}
export class IsolatedApp {
  name = "twodb-app-" + randomUUID();
  data = this.name + "-data";
  browserName = "twodb-browser-" + randomUUID();
  browser?: JsonProcess;
  processes: Array<{
    step: string;
    exitCode: number | null;
    startedAt: string;
    finishedAt: string;
    output: string;
  }> = [];
  constructor(public image: string) {}
  async start(source: string, signal: AbortSignal, log: (s: string) => void) {
    for (const p of sourceFiles(source)) safeFile(source, p);
    for (const p of ["node_modules", "dist", "data"])
      mkdirSync(path.join(source, p), { recursive: true });
    const deps = "twodb-deps-" + this.image.slice(7, 27),
      init = "twodb-deps-init-" + randomUUID();
    await mustDocker([
      "create",
      "--name",
      init,
      "--mount",
      `type=volume,src=${deps},dst=/app/node_modules`,
      this.image,
      "true",
    ]);
    await mustDocker(["rm", init]);
    await mustDocker([
      "run",
      "-d",
      ...hardening(this.name),
      "--mount",
      `type=bind,src=${source},dst=/app,readonly`,
      "--mount",
      `type=volume,src=${deps},dst=/app/node_modules,readonly`,
      "--mount",
      `type=volume,src=${this.data},dst=/app/data`,
      "--tmpfs",
      "/app/dist:rw,nosuid,nodev,size=128m,uid=1000,gid=1000",
      "--workdir",
      "/app",
      "--env",
      "LOOP_TEST=1",
      this.image,
      "node",
      "-e",
      "setTimeout(()=>process.exit(0),1200000)",
    ]);
    for (const args of [
      ["node", "node_modules/typescript/bin/tsc", "--noEmit"],
      [
        "node",
        "node_modules/vite/bin/vite.js",
        "build",
        "--configLoader",
        "native",
      ],
    ]) {
      const startedAt = new Date().toISOString();
      const result = await docker(
        ["exec", this.name, ...args],
        120_000,
        signal,
      );
      this.processes.push({
        step: this.processes.length === 0 ? "typecheck" : "build",
        exitCode: result.code,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: result.out,
      });
      log(result.out);
      if (result.code !== 0)
        throw new Error("Isolated application build failed");
    }
    await mustDocker([
      "exec",
      "-d",
      this.name,
      "node",
      "--import",
      "tsx",
      "server/index.ts",
    ]);
    await mustDocker(
      [
        "exec",
        this.name,
        "node",
        "-e",
        `for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:3001/api/health')).ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,200))}process.exit(1)`,
      ],
      15_000,
      signal,
    );
  }
  async browserAction(action: unknown) {
    if (!this.browser)
      this.browser = new JsonProcess([
        "run",
        "--rm",
        "-i",
        ...hardening(this.browserName, "container:" + this.name),
        this.image,
        "node",
        "/opt/runtime/browser.mjs",
      ]);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Browser tool timed out")),
        30_000,
      );
      this.browser!.onMessage = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      this.browser!.onFailure = (e) => {
        clearTimeout(timer);
        reject(e);
      };
      this.browser!.send(action);
    });
  }
  async close() {
    this.browser?.child.stdin.end();
    await docker(["rm", "-f", this.browserName, this.name]).catch(() => {});
    await docker(["volume", "rm", this.data]).catch(() => {});
  }
}
