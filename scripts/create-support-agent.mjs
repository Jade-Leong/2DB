import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(root, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);
const guide = readFileSync(path.join(root, 'docs/ELEVENLABS.md'), 'utf8');
const section = name => guide.split(`## ${name}\n\n`)[1].split('\n## ')[0].trim();
const config = {
  name: 'Loop Market — Customer Support',
  conversation_config: {
    agent: {
      first_message: section('Suggested first message'), language: 'en',
      prompt: {
        prompt: section('Agent instructions'), llm: 'gpt-4.1-mini',
        tools: [{
          type: 'client', name: 'prepare_support_ticket',
          description: 'Prepare a faithful complaint draft for the customer to review on screen. This does not submit, save, or send a ticket.',
          expects_response: true, response_timeout_secs: 20,
          parameters: {
            type: 'object', required: ['subject', 'message'],
            properties: {
              subject: { type: 'string', description: 'Concise complaint subject, 1 to 150 characters.' },
              message: { type: 'string', description: 'Faithful complaint in the customer’s words, 1 to 5000 characters; preserve exact amounts and references and do not invent details.' },
            },
          },
        }],
      },
    },
    tts: { voice_id: 'WyFXw4PzMbRnp8iLMJwY' },
    conversation: {
      max_duration_seconds: 600,
      client_events: ['audio', 'interruption', 'user_transcript', 'agent_response', 'client_tool_call'],
    },
  },
  platform_settings: { auth: { enable_auth: true } },
};
if (process.argv.includes('--default-voice')) delete config.conversation_config.tts;
const configPath = path.join(root, 'docs/elevenlabs-agent.json');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
if (process.argv.includes('--dry-run')) {
  console.log('Prepared docs/elevenlabs-agent.json. No API call made.');
  process.exit(0);
}
if (!process.env.ELEVENLABS_API_KEY) throw new Error('Set ELEVENLABS_API_KEY in .env first.');
if (process.env.ELEVENLABS_AGENT_ID?.trim()) throw new Error('An agent ID is already configured. Refusing to create a duplicate.');
let response;
try {
  response = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(config), signal: AbortSignal.timeout(20000),
  });
} catch {
  console.error('Creation outcome unknown: request interrupted. Check the ElevenLabs dashboard for Loop Market — Customer Support before retrying.');
  process.exit(1);
}
const data = await response.json();
if (!response.ok) {
  const details = JSON.stringify(data.detail ?? { status: response.status }).replaceAll(process.env.ELEVENLABS_API_KEY, '[redacted]');
  console.error(`Agent creation failed (HTTP ${response.status}): ${details}`);
  process.exit(1);
}
if (typeof data.agent_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(data.agent_id)) {
  throw new Error('Agent may have been created, but no valid ID was returned. Check the dashboard before retrying.');
}
// Persist the non-secret creation receipt before updating the local environment.
writeFileSync(path.join(root, 'docs/elevenlabs-agent-created.json'), JSON.stringify({ agent_id: data.agent_id, name: config.name }, null, 2) + '\n');
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
env = /^ELEVENLABS_AGENT_ID=.*$/m.test(env)
  ? env.replace(/^ELEVENLABS_AGENT_ID=.*$/m, `ELEVENLABS_AGENT_ID=${data.agent_id}`)
  : `${env}\nELEVENLABS_AGENT_ID=${data.agent_id}\n`;
writeFileSync(envPath, env, { mode: 0o600 });
console.log(JSON.stringify({ created: true, agentId: data.agent_id, name: config.name, authenticationRequired: true }));
