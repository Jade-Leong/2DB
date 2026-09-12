import path from "node:path";
import { fileURLToPath } from "node:url";
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const controlRoot = path.join(projectRoot, "control");
export const defaultData = path.join(controlRoot, "data/local");
export const now = () => new Date().toISOString();
export function problem(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
