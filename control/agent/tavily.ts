import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { controlRoot } from "../paths";

function tavilyKey(): string {
  if (process.env.TWO_DB_TAVILY_API_KEY !== undefined)
    return process.env.TWO_DB_TAVILY_API_KEY.trim();
  const file = path.join(controlRoot, "private", "tavily.json");
  if (!existsSync(file)) return "";
  try {
    const config = JSON.parse(readFileSync(file, "utf8"));
    if (typeof config.apiKey !== "string" || !config.apiKey.trim())
      throw new Error();
    return config.apiKey.trim();
  } catch {
    throw new Error("Tavily private credential configuration is invalid.");
  }
}

// All internet requests originate in the trusted controller, never the worker.
export const docDomains = {
  javascript: ["developer.mozilla.org"],
  node: ["nodejs.org"],
  express: ["expressjs.com"],
  react: ["react.dev"],
  sqlite: ["sqlite.org"],
  playwright: ["playwright.dev"],
  elevenlabs: ["elevenlabs.io/docs"],
  sharp: ["sharp.pixelplumbing.com"],
} as const;
export type DocTopic = keyof typeof docDomains;
export type DocSource = {
  id: string;
  url: string;
  title: string;
  content: string;
  stage: "search" | "extract";
  sha256: string;
};
export type ResearchRecord = {
  origin: "tavily-reference";
  action: "search_docs" | "extract_docs";
  at: string;
  query: string;
  topic: DocTopic;
  requestId?: string;
  durationMs: number;
  credits: number | null;
  cached: boolean;
  sources: DocSource[];
  error?: string;
};
export const researchLimits = {
  requests: 6,
  results: 4,
  responseBytes: 500_000,
  contentChars: 6000,
};
export function tavilyStatus() {
  let keyed = false;
  try {
    keyed = Boolean(tavilyKey());
  } catch {
    return {
      mode: "misconfigured",
      message:
        "Tavily private credential configuration is invalid. Check control/private/tavily.json.",
    };
  }
  return {
    mode: keyed ? "api-key" : "keyless",
    message: keyed
      ? "Controller API key configured; use Test Tavily connection to verify."
      : "Keyless Search + Extract enabled (rate-limited); use Test Tavily connection to verify.",
  };
}
export function allowedDocUrl(raw: unknown, topic: DocTopic): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search
    )
      return null;
    const allowed = docDomains[topic].some((d) => {
      const rule = new URL("https://" + d);
      return (
        u.hostname === rule.hostname &&
        (rule.pathname === "/" ||
          u.pathname === rule.pathname ||
          u.pathname.startsWith(rule.pathname + "/"))
      );
    });
    if (!allowed) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
function publicQuestion(value: string) {
  const q = value.trim();
  const key = tavilyKey();
  if (key && q.includes(key))
    throw new Error("Credentials cannot be searched.");
  if (
    !q ||
    q.length > 400 ||
    /[\r\n{}<>]|https?:|@|(?:tvly|sk)-|bearer\s|api[_ -]?key\s*[:=]|buyer-|ticket[_ -]?id/i.test(
      q,
    )
  )
    throw new Error(
      "Use a public documentation question under 400 characters, without customer details, URLs, credentials, or source code.",
    );
  for (const name of ["TWO_DB_TAVILY_API_KEY", "TWO_DB_OPENAI_API_KEY"])
    if (process.env[name] && q.includes(process.env[name]!))
      throw new Error("Credentials cannot be searched.");
  return q;
}
function clip(value: unknown, length: number) {
  let text = typeof value === "string" ? value : "";
  const key = tavilyKey();
  if (key) text = text.replaceAll(key, "[redacted]");
  for (const name of ["TWO_DB_TAVILY_API_KEY", "TWO_DB_OPENAI_API_KEY"])
    if (process.env[name])
      text = text.replaceAll(process.env[name]!, "[redacted]");
  return text.slice(0, length);
}
function digest(content: string) {
  return createHash("sha256").update(content).digest("hex");
}
async function responseJson(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    if ([429, 432, 433].includes(response.status))
      throw new Error(
        "Tavily rate or usage limit reached. Continue with local evidence or configure a controller API key.",
      );
    if ([401, 403].includes(response.status))
      throw new Error(
        "Tavily authentication rejected. Check the controller credential.",
      );
    throw new Error(
      "Tavily request failed; no provider error body is exposed.",
    );
  }
  if (!response.body) throw new Error("Tavily returned no response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > researchLimits.responseBytes)
        throw new Error("Tavily response exceeded the controller size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Tavily returned invalid JSON.");
  }
}

export class ResearchSession {
  records: ResearchRecord[] = [];
  private sources = new Map<
    string,
    { source: DocSource; topic: DocTopic; query: string }
  >();
  private cache = new Map<string, ResearchRecord>();
  private requests = 0;
  private nextSource = 1;
  constructor(private transport: typeof fetch = fetch) {}
  async execute(
    action: "search_docs" | "extract_docs",
    target: string,
    value: string,
    signal: AbortSignal,
  ): Promise<ResearchRecord> {
    signal.throwIfAborted();
    let topic: DocTopic, query: string, url: string | undefined;
    if (action === "search_docs") {
      if (!Object.hasOwn(docDomains, target))
        throw new Error(
          "Choose a supported documentation topic: " +
            Object.keys(docDomains).join(", "),
        );
      topic = target as DocTopic;
      query = publicQuestion(value);
    } else {
      const found = this.sources.get(target);
      if (!found)
        throw new Error(
          "Extract only a source ID returned by this investigation's search_docs.",
        );
      topic = found.topic;
      query = publicQuestion(value || found.query);
      url = found.source.url;
    }
    const cacheKey = JSON.stringify([action, target, query]);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      const record = {
        ...cached,
        at: new Date().toISOString(),
        cached: true,
        credits: 0,
        durationMs: 0,
      };
      this.records.push(record);
      return record;
    }
    if (this.requests >= researchLimits.requests)
      throw new Error(
        "Tavily's six-request investigation budget is exhausted. Continue locally and report remaining uncertainty.",
      );
    this.requests++;
    const record: ResearchRecord = {
      origin: "tavily-reference",
      action,
      topic,
      query,
      at: new Date().toISOString(),
      durationMs: 0,
      credits: null,
      cached: false,
      sources: [],
    };
    const started = Date.now();
    try {
      const key = tavilyKey();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (key) headers.Authorization = "Bearer " + key;
      else headers["X-Tavily-Access-Mode"] = "keyless";
      const body =
        action === "search_docs"
          ? {
              query,
              include_domains: docDomains[topic],
              max_results: researchLimits.results,
              search_depth: "advanced",
              chunks_per_source: 3,
              include_answer: false,
              include_raw_content: false,
              include_usage: true,
            }
          : {
              urls: [url],
              query,
              chunks_per_source: 3,
              extract_depth: "advanced",
              format: "text",
              include_usage: true,
              timeout: 15,
            };
      const data = await responseJson(
        await this.transport(
          "https://api.tavily.com/" +
            (action === "search_docs" ? "search" : "extract"),
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            redirect: "error",
            signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
          },
        ),
      );
      if (!Array.isArray(data?.results))
        throw new Error("Tavily returned an unexpected response shape.");
      record.requestId = clip(data.request_id, 100) || undefined;
      record.credits =
        typeof data.usage?.credits === "number" &&
        Number.isFinite(data.usage.credits) &&
        data.usage.credits >= 0
          ? data.usage.credits
          : null;
      const seen = new Set<string>();
      for (const item of data.results.slice(0, 20)) {
        const cleanUrl = allowedDocUrl(item?.url, topic);
        if (!cleanUrl || seen.has(cleanUrl) || (url && cleanUrl !== url))
          continue;
        seen.add(cleanUrl);
        const content = clip(
          action === "search_docs" ? item.content : item.raw_content,
          researchLimits.contentChars,
        );
        if (!content.trim()) continue;
        const previous = url ? this.sources.get(target) : undefined;
        const source: DocSource = {
          id: previous?.source.id || "S" + this.nextSource++,
          url: cleanUrl,
          title:
            previous?.source.title ||
            clip(item.title, 200) ||
            new URL(cleanUrl).hostname,
          content,
          stage: action === "search_docs" ? "search" : "extract",
          sha256: digest(content),
        };
        this.sources.set(source.id, { source, topic, query });
        record.sources.push(source);
        if (record.sources.length >= researchLimits.results) break;
      }
      if (!record.sources.length)
        record.error =
          "No usable documentation returned within the allowed domains. Refine the question or report the knowledge gap.";
    } catch (error) {
      if (signal.aborted) throw error;
      // Only our own fixed messages are exposed; network errors can contain secrets.
      record.error =
        error instanceof Error && error.message.startsWith("Tavily")
          ? error.message
          : "Tavily could not complete this request (network, timeout, or response error). Continue locally or retry within budget.";
    } finally {
      record.durationMs = Date.now() - started;
    }
    this.records.push(record);
    if (!record.error) this.cache.set(cacheKey, record);
    return record;
  }
}

export function researchConclusion(details: any, records: ResearchRecord[]) {
  if (!records.length)
    return { summary: "No external documentation consulted.", citations: [] };
  if (
    typeof details?.researchSummary !== "string" ||
    !details.researchSummary.trim() ||
    details.researchSummary.length > 2000 ||
    !Array.isArray(details?.citations) ||
    details.citations.length > 8
  )
    throw new Error(
      "Explain Tavily's contribution or limitation in researchSummary and provide a citations array.",
    );
  const extracted = records
    .flatMap((r) => r.sources)
    .filter((s) => s.stage === "extract");
  if (extracted.length && !details.citations.length)
    throw new Error(
      "Assess at least one extracted documentation source in citations.",
    );
  const citations = details.citations.map((c: any) => {
    const source = extracted.find(
      (s) => s.id === c?.sourceId && s.sha256 === c?.sha256,
    );
    if (
      !source ||
      digest(source.content) !== source.sha256 ||
      !["supports", "contradicts", "background"].includes(c.relationship) ||
      typeof c.relevance !== "string" ||
      !c.relevance.trim() ||
      c.relevance.length > 1000 ||
      typeof c.quote !== "string" ||
      c.quote.trim().length < 10 ||
      c.quote.length > 500 ||
      !source.content.includes(c.quote)
    )
      throw new Error(
        "Each citation needs a retrieved sourceId and sha256, an exact excerpt (10–500 characters), relationship (supports/contradicts/background), and relevance. Extract the source before citing it.",
      );
    return {
      ...source,
      quote: c.quote,
      relevance: c.relevance,
      relationship: c.relationship,
    };
  });
  return { summary: details.researchSummary, citations };
}

export async function checkTavily(transport: typeof fetch = fetch) {
  const research = new ResearchSession(transport);
  const signal = AbortSignal.timeout(55_000);
  const found = await research.execute(
    "search_docs",
    "express",
    "Express 5 rejected promises error handling next",
    signal,
  );
  if (found.sources.length)
    await research.execute(
      "extract_docs",
      found.sources[0].id,
      found.query,
      signal,
    );
  return {
    ...tavilyStatus(),
    at: new Date().toISOString(),
    verified: research.records.some(
      (r) => r.action === "extract_docs" && r.sources.length > 0,
    ),
    purpose:
      "Live connection check using a fixed public documentation question; not a bug investigation or a verified fix.",
    records: research.records,
  };
}
