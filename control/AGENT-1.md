# Milestone 3: live Agent 1

2DB — **Two agents. One reproducible bug.**

The dashboard now has a Codex SDK investigation worker, real browser-action/evidence collection, scoped source editing, agent-generated local proposals, and an isolated verification adapter. A live investigation is **not yet demonstrated on this machine**: Docker Desktop's Linux engine was unavailable and the separate worker API key/model were not configured. The dashboard deliberately shows **Setup required**. Deterministic tests do not count as a live model run.

The original marketplace and its intentional defects are preserved. Developer fixtures remain in a separate demo area. There is no live Agent 2, GitHub PR integration, automatic approval, merge, or deployment.

Setup checkpoint on September 12, 2026: Docker's Linux engine and the non-root/read-only/network-none Chromium probe are now available. End-to-end fixture validation exposed an evidence-persistence problem: results written to container tmpfs were unavailable after exit. The verifier now writes to a dedicated host evidence directory mounted only into the trusted verifier, never into candidate or browser containers. See `operator/SETUP-CHECKPOINT.md` for the actual validation outcome. No live model run is implied by these checks.

## 1. Prepare the isolated runner

Open **Docker Desktop** from the Windows Start menu and leave it running. Wait for the Linux engine to be running. If Docker asks you to install/update WSL or enable virtualization, complete Docker's instructions first; these are Windows setup tasks, not npm commands. Use Linux containers, not Windows containers. See [Docker's Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/).

In PowerShell:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
node --version
npm.cmd ci
npx.cmd playwright install chromium
docker version
npm.cmd run control:agent:prepare
```

Node.js **24+** is required. The first image build downloads Node.js, dependencies, and Chromium and can take several minutes. The build context is generated from an explicit list of package/runtime files, not the whole project. It contains no customer database, engineer key, controller source, operator notes, fixtures, or builder conversation. Build logs are under `control/data/agent-build/<id>/build.log`.

Preparation runs a real container probe: non-root identity, read-only runtime, no external network interface, denied protected paths/writes, and a working Chromium launch. Failure keeps execution disabled. The image tag depends on runtime/package content; after those files change, rerun preparation. Runtime containers use the inspected image SHA, not an unverified model-supplied image name.

## 2. Configure this worker's authentication

This programmatic worker uses a **separate OpenAI API key** with API billing. Your interactive Codex/ChatGPT login is **not reused**. Official guidance recommends API-key authentication for programmatic Codex workflows: [Codex authentication](https://developers.openai.com/codex/auth/). The integration uses the [official TypeScript SDK](https://developers.openai.com/codex/sdk/), pinned to the installed `@openai/codex-sdk` version in package-lock.json (initial implementation: 0.154.0).

Create an API key in your OpenAI Platform project. Do not paste it into this chat, a support ticket, a browser field, a source file, or a screenshot. Choose a Codex-compatible model that your API project can access. The application deliberately does not guess a model name.

In the **PowerShell window that will run 2DB**, enter:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
$agentSecret = Read-Host "OpenAI API key for the 2DB worker" -AsSecureString
$agentSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($agentSecret)
try {
    $env:TWO_DB_OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($agentSecretPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($agentSecretPointer)
    Remove-Variable agentSecret, agentSecretPointer
}
$env:TWO_DB_AGENT_MODEL = Read-Host "Codex-compatible model ID available to your API project"
npm.cmd run control:agent:status
npm.cmd run control
```

The secret is typed into a hidden prompt and stays in this terminal's process environment. It is not written into the project. Close the terminal when done, or after stopping 2DB use `Remove-Item Env:TWO_DB_OPENAI_API_KEY`. Do not run `Get-ChildItem Env:` or print the variable when sharing logs.

Use your own PowerShell window without transcription or screen recording when entering credentials. Variables set by an assistant tool session do not configure a separately opened PowerShell window. Keep using the same window for status and controller startup. There is no separate worker startup command: the controller launches the Docker worker for each investigation.

Status checks SDK installation, acceptance of the API credential/selected model by the models endpoint, Chromium readiness, and the OS isolation probe. An accepted models request does not prove a subsequent Codex generation will succeed; model compatibility, billing, quotas, and network failures are still reported as failures. No success is fabricated.

If 2DB is already running, stop **that controller terminal** with Ctrl+C before restarting it with these variables. The marketplace demo account selector does not authenticate this worker or grant engineer privileges. No key is passed to candidate code, the browser container, the model's prompt, or Docker command-line arguments.

## 3. Keep these services running

| Window/service | Purpose | Address |
| --- | --- | --- |
| Docker Desktop | Linux isolation engine; leave open | No customer-facing port |
| PowerShell: `npm.cmd run control` | 2DB controller and model-service broker; leave open | http://127.0.0.1:3002 |
| PowerShell: `npm.cmd run dev` | Manual Loop Market; needed to submit a complaint | http://127.0.0.1:5173 (API: 127.0.0.1:3001) |

The original production command remains `npm.cmd run build` followed by `npm.cmd start` at http://127.0.0.1:3001. No existing service is killed to free a port.

Open an engineer session using a separate PowerShell window:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
npm.cmd run control:engineer
```

Copy that **local engineer key** into 2DB's login field. It is a different credential from the API key. This remains a local demo mechanism, not production authentication.

## 4. Submit and investigate the discount complaint

1. In Loop Market, select **Maya Chen · buyer** (Jamie is also supported), open **Support**, and submit a discount complaint with this exact text:

   > I used LOOP20, and checkout showed $38.40, but the simulated payment was $48.00.

2. In 2DB, choose **Refresh**, then open that real ticket. The original complaint and synthetic identity are copied through the existing read-only adapter. No hidden diagnosis is attached.
3. In **Agent 1 · Live investigation**, check that all setup indicators are ready. Click **Investigate with Agent 1**. Only an authenticated engineer can start a run.
4. Watch **Actual investigation actions**. The model chooses navigation, clicks, inputs, response inspection, and source edits through a bounded structured action protocol. This is not a replay of the independent acceptance suite or developer fixture.
5. Open the timestamped screenshots and recorded HTTP values under **Trusted browser evidence**. The backend only accepts reproduction when the preserved baseline yields a successful checkout and buyer receipt with a displayed/order total that differs from the payment, with a real screenshot and matching source/evidence hashes.
6. After reproduction, Agent 1 can read allowed application files and replace existing TypeScript/CSS source inside `src/` or `server/`. Wider changes must be escalated. No candidate build or execution occurs here.
7. If the model finishes a changed proposal, click **Review agent-generated proposal**. Review the explanation, uncertainty/verification suggestions, original complaint, actual computed diff, source hashes, thread ID, and evidence. The state is **Awaiting engineer approval**. Starting the investigation did not approve this patch.

If the complaint cannot be reproduced, the run ends as **Not reproduced**, **Needs more information**, **Blocked**, or **Failed**. A model's claim alone is not evidence. There is no automatic fixture fallback. Repeated clicks cannot create simultaneous runs. **Cancel investigation** stops only that run's owned containers. Runs are bounded to 60 actions and 12 minutes; individual browser/model turns also have deadlines. Usage is SDK-reported token counts, without guessed dollar costs or private reasoning.

Startup troubleshooting: a run with no thread ID may indicate worker initialization failure, even if the basic setup probe passed. The runtime must declare ES modules and use the named HTTP-only broker provider (`supports_websockets: false`); the built-in provider may try WebSockets. After a runtime correction, rebuild with `npm.cmd run control:agent:prepare`, refresh dashboard setup status, and start a fresh investigation. Keep the controller's existing PowerShell window open to retain its private environment. Never retry by disabling the sandbox. See `operator/SETUP-CHECKPOINT.md` for the September 12 startup diagnosis and credential-free transport test.

## 5. Approve and independently test

When you are satisfied with the actual candidate diff, select **Approve this revision for testing**. Approval binds the exact source, requirements, and harness identities. A changed candidate invalidates approval. Agent proposals cannot be swapped for the developer fixture. Request changes and start a fresh investigation for a new revision.

**Stop the manual Loop Market terminal with Ctrl+C before independent verification. Leave Docker Desktop and 2DB running.** The existing port-3001 occupancy check is preserved. An occupied port shows:

> Stop Loop Market with Ctrl+C, then retry verification.

Select **Run scripted verification**. For an agent-generated proposal, both baseline and candidate execute in disposable Linux containers. The candidate never enters the trusted-fixture host runner. Independent Playwright tests execute in a separate container sharing only the assigned application network namespace and disposable database volume, without model credentials. The trusted harness and evidence are not mounted into the application container. Verification still requires the same D01–D08 checks, including actual saved payment values, isolation between buyers, and retry deduplication. K01 history and K02 photo remain separate known defects. A discount pass is not “all bugs fixed.”

The original developer-authored fixture buttons and milestone-2 commands retain their existing behavior and host runner. They are visibly separate from live investigations. Agent 2 says **Live agent not connected — scripted verification available.**

## Isolation design and limits

Tavily documentation research is available through controller-dispatched `search_docs` and `extract_docs` actions after browser reproduction. Search is limited to approved documentation domains; extraction accepts only source IDs found in that investigation. The controller holds the Tavily credential and makes bounded REST requests. Research and exact-quote citations are stored separately from browser evidence and cannot authorize edits, execution, or approval. See [Tavily setup](../docs/TAVILY.md) for the connection check, request budget, credentials, and demonstration flow. Native worker web search and unrestricted network access remain disabled.

- Model worker: official TypeScript Codex SDK in a fresh, mount-free, non-root container, `read-only` Codex mode, native shell/unified exec and web search disabled, no host/user home or previous thread. `startThread()` is called once per investigation; subsequent turns stay within that fresh thread. No builder thread is resumed.
- The model chooses one JSON-schema action per SDK turn. Trusted host code dispatches only known browser/file actions. No model-selected shell command is exposed. Traversal, links, hardlinks, special files, paths outside the handoff, and dependency/config edits are refused.
- Containers use `--network none`, dropped capabilities, `no-new-privileges`, read-only root, temporary writable storage, and CPU/memory/process limits. Browser and verifier containers share only the assigned app's isolated loopback network, not the Windows host network. No dashboard ports are published. See [Docker runtime isolation](https://docs.docker.com/engine/containers/run/) and [the none network driver](https://docs.docker.com/engine/network/drivers/none/).
- The SDK's local HTTP transport travels over its stdio protocol to a trusted controller broker. The broker can call only the fixed OpenAI Responses endpoint and the configured model. Only this broker has the real API key; the SDK container gets a non-secret transport placeholder. Model-service responses are streamed back without storing raw request/response bodies or reasoning.
- Browser actions have no evaluate, arbitrary request, upload, or shell facility. Trusted Playwright tooling records screenshots, page observations, checkout/receipt responses, and integer-cent values outside editable source. Browser requests are restricted to the assigned marketplace. The initial buyer session is setup, not a secret reproduction script.
- The candidate app sees a read-only application snapshot, read-only installed dependencies, and its own disposable data/output storage. It cannot mount the controller, operator notes, trusted tests, fixture fix, host user profile, Docker socket, or engineer key. Model-service and engineer credentials are absent.
- This is an OS-enforced local container boundary, not a claim of protection against Docker/kernel/browser vulnerabilities. Docker Desktop and the trusted controller are privileged operator infrastructure. Keep them updated. Do not expose this demo on a public interface. No unsafe host-execution fallback exists if the container probe fails.

## Data and recovery

`control/data/local/controller.sqlite` stores investigation state, timestamps, SDK thread ID, usage, proposal links, and evidence references. Each new run uses `control/data/local/investigations/<run-id>/baseline`, `candidate`, and `evidence`. Baseline source remains unchanged. Real customer data stays in `data/local/`; investigation/test data never resets it.

Only `browser-<n>.png` and `browser-<n>.json` records registered to that run are downloadable through the authenticated evidence API. Independent run artifacts continue to use the original evidence view. No API accepts a manually entered “passed” result.

Do not reset Loop Market or delete the controller database to retry an investigation. Correct setup and start a new run. Interrupted investigations are marked failed on controller restart. Normal cancellation/finish removes only the run's named containers and disposable data volume. After an abrupt machine/controller failure, Docker Desktop may show leftover `twodb-*` containers; inspect them in Docker Desktop and remove only those belonging to this project. Do not run a global Docker prune or stop unrelated containers. Credentials and all runtime data remain gitignored.

## Checks and current demonstration status

```powershell
npm.cmd run control:check
npm.cmd run control:agent:test
# Stop the manual marketplace before this existing integration suite:
npm.cmd run control:test
```

The Agent 1 tests use a separate controller database, explicit test-engineer session, injected setup failures, and clearly identified synthetic evidence. They make no paid model requests and do not approve real dashboard proposals. They test authorization, setup blocking, duplicate/cancel behavior, path/symlink restrictions, evidence gates, exact approval invalidation, preserved originals, and desktop/mobile UI. The existing controller suite still runs real baseline/unchanged/fixed Playwright scenarios.

Actual results and setup blockers are recorded in [the milestone-3 operator report](../operator/MILESTONE-3-RESULTS.md). No live model attempt, agent-discovered fix, or tested generated candidate is claimed until an actual authenticated, isolated run finishes. No real dashboard proposal is automatically approved.
