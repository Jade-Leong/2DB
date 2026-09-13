import { readSource, type Action } from "./policy";
import { revision, sourceFiles } from "../snapshots";
export function sourceObservation(candidate: string, action: Action) {
  if (action.action === "list")
    return sourceFiles(candidate).filter((p) => !p.endsWith(".png"));
  if (action.action === "read") {
    const content = readSource(candidate, action.target);
    const offset = action.value === "" ? 0 : Number(action.value);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.length)
      throw new Error("Read value must be a valid character offset, or empty");
    return {
      path: action.target,
      revision: revision(candidate),
      content: content.slice(offset, offset + 32_000),
      offset,
      nextOffset: content.length > offset + 32_000 ? offset + 32_000 : null,
      truncated: content.length > offset + 32_000,
    };
  }
  if (action.action === "search") {
    if (!action.value || action.value.length > 300)
      throw new Error("Provide a literal source query of 1-300 characters");
    const matches: any[] = [];
    for (const file of sourceFiles(candidate).filter((p) =>
      p.startsWith(action.target),
    )) {
      if (matches.length >= 40) break;
      let content;
      try {
        content = readSource(candidate, file);
      } catch {
        continue;
      }
      for (const [line, text] of content.split("\n").entries()) {
        if (text.includes(action.value))
          matches.push({
            file,
            line: line + 1,
            text: text.slice(0, 500),
          });
        if (matches.length >= 40) break;
      }
    }
    return { revision: revision(candidate), matches, limit: 40 };
  }
  throw new Error("Unsupported source action");
}
