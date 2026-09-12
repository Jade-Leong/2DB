# Voice support setup

The customer support page offers **Fill out a form** or **Talk it through**. Voice support is configured locally with an authenticated ElevenLabs agent. The form works without ElevenLabs.

## Create the prepared agent through the API

The creation script and `docs/elevenlabs-agent.json` contain the requested voice, support prompt, first message, and client draft tool. With a key configured privately in `.env`, run `node scripts/create-support-agent.mjs` using Node 24+. The script saves the returned agent ID into `.env` and refuses to create another agent when an ID is already configured. `--dry-run` only prepares the configuration.

The key must have ElevenLabs Agents write permission (`convai_write`) to create the agent, plus read permission (`convai_read`) for inspection and session setup. The initial permission issue has been resolved. Agent `agent_5201m2bywe1nekxv3xxzegq1v3ck` (Loop Market — Customer Support) was created on September 12, 2026, and its ID saved privately in `.env`. The client draft tool and signed-session authentication were verified through the provider API. Do not create another agent for this setup. If a creation request is interrupted, check the ElevenLabs dashboard before retrying to avoid duplicates.

## Configure when ready

1. Create a conversational agent in ElevenLabs Agents. Select the requested voice linked below and choose a conversational model in that dashboard.
2. Turn on agent authentication (private agent / signed URL access).
3. Use the first message and instructions below. Enable the `user_transcript` and `agent_response` client events so the browser can show both sides of the conversation.
4. Add a **client tool** named `prepare_support_ticket` with two required string parameters: `subject` (1–150 characters) and `message` (1–5000 characters). Describe it as preparing a draft for the customer to review, without submitting anything. Enable **Wait for response** so the agent knows whether the draft was accepted.
5. Create an API key with access to that agent's conversation-session endpoint. Copy `.env.example` to `.env` in the project root, then fill in `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` privately. Do not paste your key into chat or commit it. `.env` is gitignored and excluded from the investigator snapshots.
6. Restart the marketplace with Node 24+: `npm run build`, then `npm start`. Open http://127.0.0.1:3001/#/support, choose **Talk it through**, and start a conversation. Allow microphone access when the browser asks.

The root `.env` is loaded by the marketplace server only in manual mode. Automated tests skip that file. Shell environment values take precedence over `.env`. Production secrets should be set in the hosting provider's secret settings. Do not prefix these variables with `VITE_`: those are browser-visible.

## Requested voice

User-selected voice: [ElevenLabs voice WyFXw4PzMbRnp8iLMJwY](https://elevenlabs.io/voices/WyFXw4PzMbRnp8iLMJwY).

Select this voice in the agent's voice settings when creating the agent. This is a voice reference, not the `ELEVENLABS_AGENT_ID` required by the app. After the user added the voice to their account, the agent was updated to `WyFXw4PzMbRnp8iLMJwY` on September 12, 2026. The provider API confirmed that this voice is saved on the existing support agent; signed-session authentication and the client draft tool remain configured. A live audio conversation still needs to be tested.

## Suggested first message

Hi, I’m Loop’s AI support assistant. Tell me what happened, and I’ll help put together a complaint for you to review. What went wrong?

## Agent instructions

You are the voice support intake assistant for Loop Market, a fictional shopping demo. Your job is to listen and prepare a clear complaint, not investigate source code, diagnose hidden defects, promise refunds, or claim an issue is fixed.

Ask one short question at a time. Find out what the customer tried to do, what they expected, what happened instead, and any relevant product name or order reference. Do not request passwords, API keys, payment-card details, or other sensitive information. The demo uses fictional information and simulated purchases.

Use the customer's words and preserve exact amounts and references. Never invent missing details. When there is enough information, briefly repeat the problem back and ask if you understood correctly. Incorporate corrections, then call prepare_support_ticket with a concise subject and a faithful message, within the stated limits.

After the tool accepts the draft, explain that it is ready on screen. Ask the customer to choose End & review complaint, make any edits, and click Submit complaint. The tool creates a draft only. Never claim that a ticket has been saved, sent, or assigned. The customer submits it themselves in the app.

## What happens to the data

- Audio goes directly from the browser to ElevenLabs during the voice session. Provider retention follows your ElevenLabs account and agent settings.
- The API key stays on the server. The browser receives a temporary signed WebSocket URL only after an explicit start action by a selected demo account.
- The transcript and draft stay in the page until submission or navigation. If the agent does not call the draft tool, ending the conversation copies the customer's transcript into an editable complaint.
- Only the reviewed subject and message are saved to the existing local support-ticket database. They appear in 2DB's existing ticket inbox on refresh. Raw audio is not stored by this app. The full transcript is not attached automatically.
- Muting, ending, changing account, or leaving support manages the microphone/session lifecycle. Provider and microphone errors offer the form as a fallback.

## Validation

`npm run build` and `npm run test:support` check compilation, server-side session exchange with mocked provider responses, and browser flows with a simulated voice adapter. Browser tests still submit the reviewed complaint through the real local API. `npm run test:smoke` checks the marketplace, including manual support intake. Stop the manual marketplace before these browser checks use port 3001.

The reviewed source-hash manifest in `control/fixtures/original-source.json` is refreshed for the authorized support additions and includes the new files. The existing discount, history, and photo defects are preserved; the independent controller verification still exercises them. Existing frozen proposals and their approvals are not rewritten.

No live ElevenLabs call is claimed until credentials are configured and a real microphone conversation is tested. Configuration presence enables the Start button; an invalid key, agent, missing microphone, or unavailable provider can still prevent connection.

## Deployment direction

Start with an invite-only demo. A Node 24 Railway service with a persistent volume can host the customer marketplace and SQLite/uploads, after configurable host/port and access control are added. The engineer dashboard and its code execution workers should remain private. A remote marketplace needs an authenticated ticket adapter to replace the controller's current direct read of the local SQLite file. These deployment changes are not part of this voice scaffold.

References:
- https://elevenlabs.io/docs/eleven-agents/libraries/java-script
- https://elevenlabs.io/docs/eleven-agents/customization/authentication
- https://docs.railway.com/volumes
