# Vercel frontend with a local 2DB backend

For the hackathon, the Vercel site is only the frontend. Agent 1, Agent 2, Docker Desktop isolation, browser adapters, and the verification harness remain local. The failed `twodb-host-runtime` nested-Docker deployment is retained for historical handoff but is not the active backend.

## Start the controller

Open PowerShell in the repository root. Configure the Vercel origin before exposing the controller:

The controller automatically loads a private, gitignored `.env` from the repository root. Because the GitHub integration executes in this local process, GitHub App variables configured only in Vercel are not visible to it. On a machine authorized for the Vercel project, pull the existing production values before starting the controller:

```powershell
npx.cmd vercel env pull .env --environment=production
```

Set `GITHUB_APP_PUBLIC_URL` in `.env` to the current public controller origin. With a Quick Tunnel, this is its current `https://<random>.trycloudflare.com` URL and must be updated whenever that URL changes. A named tunnel avoids that recurring change. The GitHub App callback URL must be the same origin followed by `/engineer-api/github/callback`.

```powershell
$env:CONTROL_PUBLIC = "1"
$env:CONTROL_ALLOWED_ORIGINS = "https://twodb-steel.vercel.app"
npm.cmd run control
```

The controller listens on `127.0.0.1:3002`. It keeps Docker Desktop isolation; the marketplace app used by Agent 1 remains its separate local process on port 3001 when an investigation starts.

## Expose it with Cloudflare

Do not install `cloudflared` automatically. If it is already installed, open a second PowerShell window and run:

```powershell
cloudflared tunnel --url http://127.0.0.1:3002
```

Copy the temporary `https://<random>.trycloudflare.com` URL printed by cloudflared. Keep that terminal running. A quick health check is:

```powershell
$BackendUrl = "https://<random>.trycloudflare.com"
(Invoke-WebRequest -UseBasicParsing "$BackendUrl/api/health").Content
```

The response contains only `{ "ok": true, "app": "2DB" }`. The tunnel reaches the controller, never Docker's socket or a filesystem service.

## Configure Vercel

Set the production frontend variable to the copied HTTPS URL. Do not put an API key, engineer key, Docker secret, or controller `.env` value in Vercel:

```powershell
$BackendUrl = "https://<random>.trycloudflare.com"
$BackendUrl | npx.cmd vercel env add VITE_TWO_DB_API_BASE_URL production
```

If Vercel asks whether to overwrite an existing value, choose the production value. The public control dashboard reads this value at build time. Local control pages default to their current origin when the variable is absent. If the production variable is absent, the hosted dashboard deliberately shows `Agent backend is offline. Start the local 2DB runtime to continue.` and does not fall back to the unhealthy hosted sandbox.

Redeploy only the frontend after changing the variable:

```powershell
npx.cmd vercel deploy --prod --yes
```

The generated public build contains the configured backend URL only; no private credentials are bundled. The controller permits only the configured `CONTROL_ALLOWED_ORIGINS`, does not use wildcard CORS, and continues to require engineer authentication for engineer routes.

## Manual end-to-end Agent 1 demo

This is intentionally manual because starting live Agent 1 can spend OpenAI credits. First verify the tunnel health response above, open `https://twodb-steel.vercel.app/control/`, sign in with the existing engineer-session flow, select a ticket, and choose the Agent 1 start control. Watch the run timeline for browser evidence, model-call pacing, candidate revision, rebuild/health events, and the final state. Do not click the control until the backend status says `Agent backend connected`. A disconnected backend displays the exact offline message and never shows scripted or fake results.

The dashboard's Agent 1 start request is sent to the configured tunnel URL. The backend's `/api/health` and `/health` endpoints are safe and credential-free; engineer APIs remain bearer-token protected. Do not expose any other local service or change the tunnel target to Docker, port 3001, or a debug endpoint.

## Checks before sharing the demo

```powershell
npm.cmd run build
npm.cmd run control:check
node --import tsx --test --test-concurrency=1 control/tests/controller.test.ts control/tests/accounts.test.ts control/tests/agent.test.ts control/tests/agent2.test.ts
```

These checks do not start a billable live investigation. Docker isolation is verified separately with `npm.cmd run control:agent:prepare`; it must be run locally, never inside the failed hosted sandbox.
