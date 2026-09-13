# Tavily in 2DB

Tavily gives Agent 1 a bounded way to investigate a technical uncertainty using official documentation. The controller calls Tavily Search and Extract directly over REST. The model worker remains offline and uses its existing structured action interface.

## Try it now

Use Node.js 24+ in the 2DB directory. On macOS:

```sh
npm run control:research:check
npm run control
```

Open http://127.0.0.1:3002. In another terminal, run `npm run control:engineer` and use the local engineer key to sign in. The **Powered by Tavily** panel appears even before a ticket is selected. Click **Test Tavily connection** to run a live Search followed by Extract and inspect the source cards. Checks are limited to one per minute. This does not require Docker or invoke a model.

The command-line check saves a timestamped report with provider request IDs, excerpts, and reported credit usage in `control/test-results/tavily/live-check.json`. Neither a connection check nor synthetic test output is a successful bug investigation.

On Windows PowerShell, use `npm.cmd` instead of `npm`.

## Credentials

The controller reads `TWO_DB_TAVILY_API_KEY` from its process environment first. If unset, it reads the `apiKey` property from `control/private/tavily.json`. This private directory is gitignored; keep the file readable only by its owner. The dashboard never accepts or returns this credential, and it is not mounted into containers. A credential has been configured privately on the setup machine; it is intentionally absent from the repository.

With neither credential present, the controller uses Tavily's rate-limited keyless Search and Extract. An explicitly empty environment variable selects keyless mode even if the private file exists. A configured key that fails is reported as a failure, not silently replaced with keyless access. Keep the Tavily credential separate from the OpenAI worker key and local engineer-session key.

The interactive Tavily CLI login is separate from this application's REST integration. 2DB does not spawn the CLI or read personal OAuth tokens.

## Agent workflow

1. Submit a supported buyer complaint and start Agent 1 after its existing setup indicators pass.
2. Agent 1 reproduces the failure in the unchanged baseline. Browser evidence must pass the existing reproduction gate.
3. When external knowledge is useful, Agent 1 reads dependency information and chooses a public documentation question. `search_docs` takes a topic in `target` and the question in `value`.
4. Search returns at most four source IDs and excerpts. `extract_docs` takes one of those IDs and an optional focused question. Arbitrary URLs cannot be extracted.
5. The dashboard records the query, source links, timestamps, provider request IDs (in the run record), latency, cache reuse, and provider-reported usage. Search snippets are discovery; citations require extracted content.
6. The final proposal includes `researchSummary` and a `citations` array whenever research was attempted. Each citation names an extracted `sourceId` and `sha256`, quotes an exact excerpt, describes relevance, and labels its relationship as `supports`, `contradicts`, or `background`.
7. **Why these sources matter** shows the contribution beside the proposal. The controller validates source identity, content hash, and exact excerpt. The agent's interpretation and version applicability remain claims for the reviewer to assess.
8. Engineer approval and independent baseline-versus-candidate tests remain necessary. External documentation can never satisfy the reproduction gate or authorize execution.

Supported topics: JavaScript/MDN, Node.js, Express, React, SQLite, Playwright, ElevenLabs documentation, and Sharp. Domains are selected by trusted controller code and post-filtered. Adding a new topic means reviewing `docDomains` in `control/agent/tavily.ts`; the model cannot expand the allowlist.

## Limits and failure behavior

- Six external requests per investigation, including failed attempts; repeated successful requests reuse a per-investigation cache.
- Four search results, one URL per extraction, 6,000 characters per excerpt, a 500 KB response cap, and a 25-second request timeout.
- Cancellation propagates to the HTTP request. No automatic retry loop or provider fallback.
- Only fixed Tavily endpoints receive requests. HTTPS source URLs must match the topic allowlist; credentials, nonstandard ports, and query strings in source URLs are refused.
- Prompts instruct the model to send public technical questions, never customer data or source code. Validation rejects common credential, URL, email, and code patterns. This is a constrained demo policy, not a general-purpose data-loss-prevention guarantee.
- Retrieved content is untrusted reference material. It cannot grant permissions or change the action schema. The UI escapes source text and opens source links with no opener access.
- Provider failures, empty results, missing credentials, and exhausted budgets are visible. Agent 1 can continue from local evidence and must explain the research limitation honestly.

## Demonstration narrative

Use a real investigation with a concrete uncertainty, such as the semantics of a dependency used in the affected workflow. Show the observed failure, the agent's question, the documentation it extracts, the cited assessment, and the independent test result. Do not claim a documentation search discovered a local code defect unless the investigation evidence supports that claim. The current investigator still supports the original discount complaint; this integration does not add a new defect scenario or a live Agent 2.

## Verification

```sh
npm run control:check
npm run control:research:test
npm run control:agent:test
npm run control:research:check
```

The research unit suite uses explicitly synthetic provider responses. The agent suite checks authenticated endpoints, research after reproduction, persisted citation metadata, exact proposal approval, browser rendering, escaped source text, and mobile overflow. Only `control:research:check` or the dashboard connection button makes live Tavily requests. Full model investigations additionally require the Docker image and OpenAI configuration described in `control/AGENT-1.md`.
