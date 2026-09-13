# Support ticket ingestion

## What was broken

The ElevenLabs Flow's `prepare_support_ticket` is a browser client tool. It prepares an editable draft; it does not call a webhook and it does not save a ticket. After the customer ends the conversation and clicks **Submit complaint**, the Loop Market browser posted `/api/support` to the Vercel/marketplace path. The Cloudflare-connected controller inbox reads its own controller ticket store, so that production ticket was invisible to the inbox.

The normal support form followed the same marketplace `/api/support` path. The controller's prior inbox adapter could read a local marketplace SQLite file or a configured remote Supabase view, but it had no canonical public ticket-creation endpoint for the Cloudflare architecture.

## Fixed path

Both the reviewed support form and the reviewed ElevenLabs draft now submit to the controller's canonical `POST /api/support` when `VITE_TWO_DB_API_BASE_URL` is configured. The request carries `X-Demo-Account`, `X-Support-Source` (`support-form` or `elevenlabs`), and a persisted `Idempotency-Key`. The controller validates the demo identity, preserves the subject/message exactly, stores source, timestamp, optional related reference, and returns the ticket ID. The controller inbox merges these canonical tickets with legacy marketplace/remote tickets, so Agent 1 and Agent 2 receive the same normal ticket record.

The existing Flow still prepares a draft first and requires the customer to review and submit it. There is no external ElevenLabs callback configured in the current agent. An optional server-to-server endpoint is available for a future ElevenLabs webhook/server tool:

`POST https://<current-quick-tunnel-host>/api/support/elevenlabs`

It requires `X-ElevenLabs-Webhook-Secret`, configured only as the backend environment variable `ELEVENLABS_SUPPORT_WEBHOOK_SECRET`, plus a JSON body containing `account_id` (or `customer_id`), `subject`, and `message`; `order_reference` is accepted as an optional related reference. Configure that URL in the ElevenLabs server tool/webhook settings if the Flow is later changed to call a server tool. The current active demo tunnel endpoint is `https://research-suggestion-looksmart-panels.trycloudflare.com/api/support/elevenlabs`; Quick Tunnel URLs change after restart, so update the external ElevenLabs setting each time. Do not put that URL or secret in frontend source.

## Dashboard updates

After engineer sign-in, the dashboard polls the controller inbox every five seconds while it is open. It compares ticket IDs and timestamps before rendering, preserves the selected ticket, retains the old list if a refresh fails, and displays a retrying connection warning. The timer is cleared on sign-out or page unload. A new ticket therefore appears without a manual reload.

## Security and failure behavior

The controller requires an allowed `Origin` for browser CORS and never uses wildcard CORS. Engineer routes retain bearer-session authentication. The webhook route does not use browser CORS and rejects missing or incorrect secrets. No credentials or private configuration are returned by `/health` or `/api/health`. Invalid submissions return a useful error and are never reported as saved; uncertain duplicate retries resolve through the durable idempotency table.

The active architecture remains Vercel frontend → current Cloudflare HTTPS tunnel → local controller on port 3002 → local Docker Desktop isolation for investigations. The old hosted nested-Docker sandbox is not used.
