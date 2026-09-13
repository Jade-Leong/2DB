# Engineer handoff — September 13, 2026

## Start here

- Repository: https://github.com/Jade-Leong/2DB, branch `main`.
- Marketplace: https://twodb-steel.vercel.app/.
- Engineer dashboard: https://twodb-steel.vercel.app/control/.
- Vercel project: `twodb`, team `jade-leongs-projects`.
- Hosting has two parts: the Vercel web/API deployment and the persistent Sandbox `twodb-host-runtime`, with Drive `twodb-application-data`. Updating the web deployment alone does not update backend source.

## Production configuration

The user-provided `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_AGENT_ID` are configured as Sensitive Production variables in Vercel. Existing `TWO_DB_OPENAI_API_KEY`, `TWO_DB_AGENT_MODEL`, `TWO_DB_CLOUD_GATEWAY_KEY`, and `TWO_DB_CLOUD_ENGINEER_KEY` remain configured. Obtain account access or credentials privately; no secret values belong in Git.

The gateway forwards the Supabase configuration to marketplace/controller processes and ElevenLabs configuration to the marketplace. The outbound allowlist includes `api.elevenlabs.io` and the configured database pooler host. The database uses verified TLS and `cloud/supabase-ca.crt`, copied from `deployment/vercel/host/supabase-ca.crt` during provisioning. Without that CA, the supplied pooler connection failed with `SELF_SIGNED_CERT_IN_CHAIN`. Adding the CA passed a read-only connection/schema check; do not disable certificate verification.

The CA is a public certificate downloaded from https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt. SHA-256 certificate fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`; expires April 26, 2031.

## Deploy and verify

Use Node 24+ and PowerShell's `npm.cmd`/`npx.cmd`. Authenticate and link the Vercel CLI to the project. Provisioning requires a valid Vercel SDK credential/OIDC environment and the existing private gateway-key file; those are not in the repository.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run control:check
node --import tsx --test verification/voice-api.test.ts
# From deployment/vercel, with private deployment credentials configured:
node --env-file=.env.local provision.mjs
# From the repository root:
npx.cmd vercel deploy --prod --yes
# From deployment/vercel:
node public-smoke.mjs
node configuration-smoke.mjs
```

`public-smoke.mjs` needs the private demo engineer-key file. `configuration-smoke.mjs` checks Supabase health/products, account configuration, voice configuration, and ElevenLabs signed-session issuance. It does not start an audio conversation or create a Supabase user.

Docker's daemon can appear healthy after snapshot restore while its containerd socket is unresponsive. Provisioning now stops both daemon processes before snapshotting. A real browser/isolation probe is required after restoring; `docker info` alone does not prove execution works. Restart only this project's sandbox services when diagnosing this condition; never prune unrelated containers or delete persistent data.

## Actual feature status

Latest deployment checks passed on September 13: public pages/API/products, authenticated engineer inbox, cross-origin rejection, private-file protection, Supabase-backed health/products, account configuration enabled, and an actual ElevenLabs signed-session exchange. The agent Docker/browser setup reported Ready. Six voice API tests and seven account tests passed, including the other engineer's non-JSON error handling. Initial cold-start requests can still return 503 before the sandbox is ready; retries passed. No real microphone conversation or new Supabase signup was performed.

- The scripted discount workflow is real browser reproduction + a developer-authored fix + eight mandatory checks. The prepared fix passes and the unchanged candidate fails.
- Agent 1 has not completed a successful live investigation. Commit `f2fc9fe` fixes error handling that could obscure streamed credit errors as `sdk_transport`. Four transport tests, 12 Agent 1 tests, and actual Docker SDK success/failure checks passed without paid calls. See `operator/AGENT-1-TRANSPORT-RESULTS.md`.
- Agent 2's hosted candidate passed all eight mandatory checks, then the real model request returned HTTP 429: no credits remaining. A successful live assessment remains unvalidated. See `operator/MILESTONE-4-RESULTS.md`.
- Missing-order history and disappearing photos remain intentional unresolved scenarios. Do not label them ready or fixed.
- GitHub PR creation, merge, and deployment from the agent workflow are not implemented. Developer CLI pushes/deployments are separate.
- Account email confirmation and a real microphone conversation still require end-to-end testing. Uploaded photos remain on the hosted filesystem; Supabase Storage is not implemented.

Preserve original marketplace defects and data. Never pass `operator/`, test answer keys, private files, or builder history to a live investigator, and never substitute a fixture after a live failure.
