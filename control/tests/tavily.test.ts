import test from "node:test";
import assert from "node:assert/strict";
import { AgentService } from "../agent/service";
import { editSource, mismatch } from "../agent/policy";
import {
  ResearchSession,
  allowedDocUrl,
  researchConclusion,
  checkTavily,
} from "../agent/tavily";

const signal = () => new AbortController().signal;
const url = "https://expressjs.com/en/guide/error-handling.html";
const passage =
  "Starting with Express 5, route handlers that return a Promise will call next automatically when they reject.";
function fake(calls: any[] = []): typeof fetch {
  return (async (endpoint: any, options: any) => {
    const body = JSON.parse(options.body);
    calls.push({ endpoint, ...options, body });
    return Response.json({
      request_id: "synthetic-provider-request",
      usage: { credits: 1 },
      results: [
        {
          url,
          title: "Explicit synthetic Express documentation",
          content: passage,
          raw_content: passage,
        },
      ],
    });
  }) as typeof fetch;
}
test("controller permits research before reproduction without granting browser proof or editing access", async () => {
  const events: any[] = [];
  const controller = {
    event: (...args: any[]) => events.push(args),
  } as unknown as AgentService;
  const research = new ResearchSession(fake());
  const search = await AgentService.prototype.researchAction.call(
    controller,
    "test-run",
    "search_docs",
    "express",
    "Express 5 rejected promises",
    research,
    false,
    signal(),
  );
  const extract = await AgentService.prototype.researchAction.call(
    controller,
    "test-run",
    "extract_docs",
    search.sources[0].id,
    "",
    research,
    false,
    signal(),
  );
  assert.equal(extract.sources[0].stage, "extract");
  assert.equal(events.length, 2);
  assert.equal(events[0][3].phase, "reproduction research");
  assert.ok(!mismatch(extract, "buyer-maya", "baseline"));
  assert.throws(
    () => editSource("/unused", "server/unused.ts", "", false),
    /Browser evidence/,
  );
});
test("search/extract are host REST calls with bounded payloads, citations and cached repeats", async () => {
  const calls: any[] = [],
    r = new ResearchSession(fake(calls));
  const search = await r.execute(
    "search_docs",
    "express",
    "Express 5 rejected promises",
    signal(),
  );
  const extract = await r.execute(
    "extract_docs",
    search.sources[0].id,
    "",
    signal(),
  );
  assert.equal(calls[0].endpoint, "https://api.tavily.com/search");
  assert.deepEqual(calls[0].body.include_domains, ["expressjs.com"]);
  assert.equal(calls[0].body.max_results, 4);
  assert.equal(calls[0].redirect, "error");
  assert.deepEqual(calls[1].body.urls, [url]);
  assert.equal(extract.sources[0].id, search.sources[0].id);
  assert.equal(extract.sources[0].stage, "extract");
  assert.equal(
    (await r.execute("extract_docs", search.sources[0].id, "", signal()))
      .cached,
    true,
  );
  assert.equal(calls.length, 2);
  const source = extract.sources[0];
  const details = {
    researchSummary: "Synthetic applicability assessment.",
    citations: [
      {
        sourceId: source.id,
        sha256: source.sha256,
        quote: "route handlers that return a Promise",
        relationship: "background",
        relevance:
          "Verify applicability against the installed Express version.",
      },
    ],
  };
  assert.equal(researchConclusion(details, r.records).citations[0].url, url);
  assert.throws(
    () =>
      researchConclusion(
        {
          ...details,
          citations: [
            {
              ...details.citations[0],
              quote: "This quote was never retrieved.",
            },
          ],
        },
        r.records,
      ),
    /exact excerpt/,
  );
  assert.throws(
    () =>
      researchConclusion(
        {
          ...details,
          citations: [{ ...details.citations[0], sourceId: "S999" }],
        },
        r.records,
      ),
    /retrieved/,
  );
  assert.throws(
    () => researchConclusion({ ...details, citations: [] }, r.records),
    /Assess/,
  );
  assert.throws(() => researchConclusion(details, [search]), /Extract/);
});
test("URL and query boundaries refuse arbitrary extraction, lookalikes, credentials and private targets", async () => {
  const calls: any[] = [],
    r = new ResearchSession(fake(calls));
  for (const u of [
    "http://expressjs.com/a",
    "https://expressjs.com.evil.test/a",
    "https://127.0.0.1/",
    "https://expressjs.com:8443/a",
    "https://user:pass@expressjs.com/a",
    "https://expressjs.com/a?secret=abc",
    "javascript:alert(1)",
  ])
    assert.equal(allowedDocUrl(u, "express"), null);
  assert.equal(
    allowedDocUrl("https://elevenlabs.io/pricing", "elevenlabs"),
    null,
  );
  assert.equal(
    allowedDocUrl("https://elevenlabs.io/docs/agents", "elevenlabs"),
    "https://elevenlabs.io/docs/agents",
  );
  await assert.rejects(
    r.execute("extract_docs", url, "", signal()),
    /source ID/,
  );
  await assert.rejects(
    r.execute("search_docs", "constructor", "question", signal()),
    /supported/,
  );
  for (const q of [
    "",
    "x".repeat(401),
    "customer@example.com",
    "Bearer secret",
    "tvly-secret",
    "buyer-maya",
    "code { secret }",
    "https://private.test",
  ])
    await assert.rejects(r.execute("search_docs", "express", q, signal()));
  assert.equal(calls.length, 0);
});
test("out-of-domain results, empty extracts, and invalid bodies never become usable references", async () => {
  for (const data of [
    { results: [{ url: "https://evil.test/", content: passage }] },
    { results: [{ url, content: "" }] },
    { results: null },
  ]) {
    const r = new ResearchSession((async () =>
      Response.json(data)) as typeof fetch);
    const record = await r.execute(
      "search_docs",
      "express",
      "Express errors",
      signal(),
    );
    assert.ok(record.error);
    assert.deepEqual(record.sources, []);
    assert.equal(
      researchConclusion(
        {
          researchSummary: "Search failed; using local evidence.",
          citations: [],
        },
        r.records,
      ).citations.length,
      0,
    );
  }
});
test("provider failures are sanitized and consume the six-request budget", async () => {
  let calls = 0;
  const r = new ResearchSession((async () => {
    calls++;
    return new Response("SECRET PROVIDER BODY", { status: 429 });
  }) as typeof fetch);
  for (let i = 0; i < 6; i++) {
    const result = await r.execute(
      "search_docs",
      "express",
      "Express errors",
      signal(),
    );
    assert.match(result.error!, /usage limit/);
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
  await assert.rejects(
    r.execute("search_docs", "express", "Express errors", signal()),
    /budget/,
  );
  assert.equal(calls, 6);
});
test("oversized responses and cancellation are bounded", async () => {
  const r = new ResearchSession(
    (async () => new Response("x".repeat(500_001))) as typeof fetch,
  );
  assert.match(
    (await r.execute("search_docs", "express", "Express errors", signal()))
      .error!,
    /size limit/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    r.execute("search_docs", "express", "Express errors", abort.signal),
  );
});
test("keyed auth stays in the host request header and never enters query payloads or records", async () => {
  const previous = process.env.TWO_DB_TAVILY_API_KEY;
  process.env.TWO_DB_TAVILY_API_KEY = "tvly-synthetic-test-key";
  try {
    const calls: any[] = [],
      r = new ResearchSession(fake(calls));
    await r.execute("search_docs", "express", "Express errors", signal());
    assert.equal(
      calls[0].headers.Authorization,
      "Bearer tvly-synthetic-test-key",
    );
    assert.equal(calls[0].headers["X-Tavily-Access-Mode"], undefined);
    assert.ok(!JSON.stringify(calls[0].body).includes("synthetic-test-key"));
    assert.ok(!JSON.stringify(r.records).includes("synthetic-test-key"));
  } finally {
    if (previous === undefined) delete process.env.TWO_DB_TAVILY_API_KEY;
    else process.env.TWO_DB_TAVILY_API_KEY = previous;
  }
});
test("connection check requires both actual search and extraction responses", async () => {
  const result = await checkTavily(fake());
  assert.equal(result.verified, true);
  assert.equal(result.records.length, 2);
  assert.match(result.purpose, /not a bug investigation/);
});
