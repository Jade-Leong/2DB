import { Sandbox } from '@vercel/sandbox';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const name = 'twodb-preflight-' + randomUUID().slice(0, 8);
const report = { name, startedAt: new Date().toISOString(), status: 'running', containsApplicationData: false };
let sandbox;
try {
  sandbox = await Sandbox.create({ name, runtime: 'node24', timeout: 180000, persistent: true, networkPolicy: 'deny-all', snapshotExpiration: 86400000, keepLastSnapshots: {count: 1} });
  const first = await sandbox.runCommand('node', ['-e', "require('fs').writeFileSync('/tmp/twodb-persistence-probe','synthetic'); console.log(process.version)"]);
  if (first.exitCode !== 0) throw new Error('Runtime probe failed');
  report.node = (await first.stdout()).trim();
  await sandbox.stop();
  sandbox = await Sandbox.get({ name });
  const restored = await sandbox.runCommand('node', ['-e', "if(require('fs').readFileSync('/tmp/twodb-persistence-probe','utf8')!=='synthetic')process.exit(1)"]);
  if (restored.exitCode !== 0) throw new Error('Persistence probe failed');
  report.persistence = 'passed';
  const docker = await sandbox.runCommand('sh', ['-c', 'command -v docker || true']);
  report.dockerInstalled = Boolean((await docker.stdout()).trim());
  report.status = 'passed';
} catch (error) {
  report.status = 'blocked';
  // Provider errors may carry request metadata; never serialize the error object.
  report.error = String(error.message).replace(/(?:Bearer\s+|(?:vcp|vci|sk)[_-])[A-Za-z0-9._-]+/gi, '[redacted]').slice(0, 600);
  process.exitCode = 1;
} finally {
  if (sandbox) await sandbox.stop().catch(() => {});
  report.finishedAt = new Date().toISOString();
  mkdirSync('data', {recursive: true});
  writeFileSync('data/preflight.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
