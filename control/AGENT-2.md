# Agent 2 and scripted Agent 1 operating guide

This milestone adds two explicit paths to the existing 2DB workflow:

- **Live Agent 2** uses the official TypeScript OpenAI Agents SDK. It explores fresh Docker-isolated baseline and approved-candidate applications with restricted browser tools. The existing eight Playwright checks remain mandatory and the controller calculates the final status.
- **Scripted Agent 1 demonstration** performs a real browser reproduction and loads a developer-authored fixture. It makes zero model calls and is labeled as scripted everywhere.

The discount scenario is ready. The paid-order-history and listing-photo scenarios remain known unresolved scenarios; they have no prepared candidate or live Agent 2 contract in this milestone.

## Prerequisites and one-time setup

Install Node.js 24 or newer and start Docker Desktop with its Linux engine. Open **PowerShell — Setup**:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run control:agent:prepare
```

The Docker image is content-hashed. Run `npm.cmd run control:agent:prepare` again after dependency or Agent runtime changes if status says the image is outdated. Docker supplies the OS-enforced boundary; candidate containers receive no API key, engineer credential, controller database, operator notes, or writable verification suite.

## Private API-key entry

Use this only for live modes. In **PowerShell — 2DB controller**, enter the key at a hidden prompt:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
$agentSecret = Read-Host "OpenAI API key" -AsSecureString
$agentSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($agentSecret)
try {
    $env:TWO_DB_OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($agentSecretPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($agentSecretPointer)
    Remove-Variable agentSecret, agentSecretPointer
}
$env:TWO_DB_AGENT_MODEL = "gpt-5.4-nano"
$env:TWO_DB_AGENT_2_MODEL = "gpt-5.4-nano"
```

`TWO_DB_AGENT_2_MODEL` is the Agent 2 setting. When omitted, Agent 2 falls back to `TWO_DB_AGENT_MODEL`. `gpt-5.4-nano` supports the Responses API, function calling, and structured outputs. The status check validates project access without displaying the key; a live run is the final tool-compatibility check.

Environment variables exist only in that PowerShell window. Start the controller from the same window:

```powershell
npm.cmd run control:agent:status
npm.cmd run control:agent2:status
npm.cmd run control
```

Keep **PowerShell — 2DB controller** open. Open `http://127.0.0.1:3002`.

Open **PowerShell — Engineer key** and run:

```powershell
Set-Location "C:\Users\jadey\Desktop\OneNote\NYU\Senior Year\loop-market"
npm.cmd run control:engineer
```

Use that key on the 2DB sign-in screen. This is a local demo approval mechanism, not production authentication.

## Scripted Agent 1 demonstration + live Agent 2

1. Keep Docker Desktop and both PowerShell windows open.
2. If Loop Market is running on port 3001, stop only that process with `Ctrl+C`. Verification owns port 3001 temporarily; 2DB stays on 3002.
3. Open the discount complaint in 2DB.
4. Under **Agent 1 · Scripted demonstration**, select **Prepared discount fix** and click **Use scripted demo**.
5. Wait for **Awaiting engineer review**. Open the fresh screenshot and observed-values artifact. Expected reproduction evidence is displayed/order `3840` cents and payment `4800` cents.
6. Open the proposal, read the actual diff and hashes, then click **Approve this revision for testing**. The scripted demonstration cannot approve itself.
7. Confirm Agent 2 shows **Ready**, then click **Verify with live Agent 2**. Billable API use starts only because you clicked it.
8. Review the mandatory baseline/candidate checks and live browser actions. The model assessment, executed checks, and controller status are separate.

For a real failure demonstration, choose **Unchanged negative control** in step 4. Its required checks fail; approval cannot make it pass, and live exploration does not run after the mandatory failure.

## Fully scripted rehearsal with no API calls

Follow steps 1–6 above, then click **Run scripted verification only**. This path uses Docker and Playwright but invokes neither live agent. It is labeled **Scripted verification only** in the run and activity history.

The prepared fix reaches **Verified awaiting engineer review** only when all eight checks pass and the baseline reproduces D01. The unchanged control reaches **Failed**.

## Fully live mode

1. Confirm both status commands report **Ready**.
2. Open the discount ticket and click **Investigate with Agent 1**.
3. If Agent 1 produces a proposal, review its evidence and exact controller-computed diff.
4. Approve that exact revision.
5. Click **Verify with live Agent 2**.

A failed live Agent 1 run remains visible. The controller never switches modes automatically.

## Checks

```powershell
npm.cmd run control:check
npm.cmd run control:agent:test
npm.cmd run control:agent2:test
npm.cmd run control:test
npm.cmd run control:scripted-demo:check
npx.cmd tsx control/tests/agent2-docker.check.ts
```

`control:agent2:test` uses mocked model integration and is not proof of a live API run. The Agent 2 Docker checkpoint runs the real isolated mandatory suite, but deliberately uses a mocked incomplete model layer and ends inconclusive. `control:test` and `control:scripted-demo:check` execute real browser/application evidence. Test data stays outside `data/local/`.

## Current limitations

- A hosted live Agent 2 test passed all eight mandatory checks, then ended Inconclusive because OpenAI returned HTTP 429 (no API credits remaining). Add credits to the configured API account before retrying. A successful live model assessment is not yet validated.
- Missing-order-history and listing-photo scenarios are not ready in this milestone.
- Live Agent 1 still depends on its Codex SDK response transport completing successfully.
- There is no GitHub PR creation, merge, deployment, or automatic repair loop.
