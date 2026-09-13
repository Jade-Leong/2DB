import { Sandbox } from '@vercel/sandbox';
import { mkdirSync, writeFileSync } from 'node:fs';
const name = 'twodb-host-runtime';
let sandbox;
const report = { name, startedAt: new Date().toISOString(), status: 'running' };
try {
  sandbox = await Sandbox.create({ name, runtime: 'node24', timeout: 1200000, resources: {vcpus: 4}, persistent: true, snapshotExpiration: 86400000, keepLastSnapshots: {count: 1}, networkPolicy: 'allow-all' });
  console.log('Hosted trusted runtime created; installing Docker. No application source or credentials uploaded.');
  const os = await sandbox.runCommand('cat', ['/etc/os-release']);
  report.os = (await os.stdout()).trim();
  const install = await sandbox.runCommand({cmd:'sh', args:['-c','dnf install -y docker'], sudo:true});
  report.installExit = install.exitCode;
  if(install.exitCode !== 0) throw new Error('Docker installation failed');
  await sandbox.runCommand({cmd:'sh',args:['-c','dockerd > /tmp/twodb-docker.log 2>&1'],sudo:true,detached:true});
  const probe = await sandbox.runCommand({cmd:'sh',args:['-c','for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'],sudo:true});
  report.engineExit = probe.exitCode;
  if(probe.exitCode !== 0) {
    const logs=await sandbox.runCommand({cmd:'tail',args:['-30','/tmp/twodb-docker.log'],sudo:true});
    report.engineLog = await logs.stdout();
    throw new Error('Hosted Docker engine could not start');
  }
  const isolated = await sandbox.runCommand({cmd:'docker',args:['run','--rm','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','node:24-bookworm-slim','node','-e',"if(process.getuid()===0||Object.keys(require('os').networkInterfaces()).some(n=>n!=='lo'))process.exit(1);console.log('isolated')"],sudo:true});
  report.containerExit=isolated.exitCode;
  if(isolated.exitCode!==0)throw new Error('Hosted isolated container probe failed');
  report.status='passed';
} catch(error) { report.status='blocked';report.error=String(error.message).slice(0,500);process.exitCode=1; }
finally {
  if(sandbox)await sandbox.stop().catch(()=>{});
  report.finishedAt=new Date().toISOString();
  mkdirSync('data',{recursive:true});writeFileSync('data/docker-preflight.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
