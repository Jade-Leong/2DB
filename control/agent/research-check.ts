import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { controlRoot } from "../paths";
import { checkTavily } from "./tavily";

const result = await checkTavily();
const directory = path.join(controlRoot, "test-results", "tavily");
mkdirSync(directory, { recursive: true });
writeFileSync(
  path.join(directory, "live-check.json"),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      verified: result.verified,
      mode: result.mode,
      at: result.at,
      requests: result.records.map((r) => ({
        action: r.action,
        requestId: r.requestId,
        sources: r.sources.length,
        error: r.error,
      })),
      artifact: "control/test-results/tavily/live-check.json",
    },
    null,
    2,
  ),
);
if (!result.verified) process.exitCode = 1;
