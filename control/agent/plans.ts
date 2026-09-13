import { parseAction, type Action } from "./policy";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const safe = new Set([
  "open",
  "inspect",
  "click",
  "fill",
  "select",
  "screenshot",
  "responses",
  "list",
  "read",
  "search",
]);
export function actionPlan(action: Action): Action[] {
  if (action.action !== "batch") return [action];
  const items = JSON.parse(action.value);
  if (!Array.isArray(items) || items.length < 1 || items.length > 5)
    throw new Error("A safe batch must contain 1–5 actions.");
  return items.map((item) => {
    const parsed = parseAction(item);
    if (!safe.has(parsed.action))
      throw new Error("This action requires a separate model decision.");
    return parsed;
  });
}

// Validate the entire plan before executing any action. Never replay a prefix.
export async function executePlan(
  action: Action,
  execute: (a: Action, safeOnly: boolean, index: number) => Promise<any>,
) {
  const plan = actionPlan(action),
    observations = [];
  for (const [index, item] of plan.entries()) {
    try {
      const result = await execute(item, action.action === "batch", index);
      observations.push({ action: item.action, result });
      if (result?.ok === false || result?.error) break;
    } catch (error) {
      observations.push({
        action: item.action,
        result: {
          error: error instanceof Error ? error.message : "Action refused",
        },
      });
      break;
    }
  }
  return { observations, completed: observations.length, planned: plan.length };
}

// A pending entry is deliberately not retried: execution may already have happened.
export async function recordedAction(
  file: string,
  execute: () => Promise<any>,
) {
  if (existsSync(file)) {
    const entry = JSON.parse(readFileSync(file, "utf8"));
    if (entry.state === "completed") return entry.result;
    throw new Error("Action outcome is uncertain; automatic replay refused.");
  }
  writeFileSync(file, JSON.stringify({ state: "pending" }), {
    flag: "wx",
    flush: true,
  });
  const result = await execute();
  writeFileSync(file, JSON.stringify({ state: "completed", result }), {
    flush: true,
  });
  return result;
}

export class ModelGate {
  private busy = false;
  private last = 0;
  constructor(private spacingMs = 10_000) {}
  async run<T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Concurrent model request refused");
    this.busy = true;
    try {
      const wait = this.spacingMs - (Date.now() - this.last);
      if (wait > 0) await delay(wait, undefined, { signal });
      signal.throwIfAborted();
      this.last = Date.now();
      return await request();
    } finally {
      this.busy = false;
    }
  }
}
