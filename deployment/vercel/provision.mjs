import {Sandbox,Drive} from '@vercel/sandbox';
import {readFileSync,readdirSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ensureDocker} from './runtime.mjs';
const project=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const destination='/home/vercel-sandbox/twodb';
const list=[];
function visit(relative){
  if(/(^|\/)(data|private|node_modules|test-results|playwright-report|operator|\.git)(\/|$)/.test(relative))return;
  const p=path.join(project,relative),stat=lstatSync(p);
  if(stat.isSymbolicLink()||(!stat.isDirectory()&&(!stat.isFile()||stat.nlink!==1)))throw Error('Unsupported source entry');
  if(stat.isDirectory()){for(const name of readdirSync(p).sort())visit(relative+'/'+name);}
  else if(!/(^|\/)README\.md$/.test(relative))list.push({relative,content:readFileSync(p)});
}
for(const dir of ['src','server','public','control','verification'])visit(dir);
for(const file of ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','.gitignore','INVESTIGATOR_SETUP.md'])list.push({relative:file,content:readFileSync(path.join(project,file))});
list.push({relative:'README.md',content:readFileSync(path.join(project,'INVESTIGATOR_SETUP.md'))});
for(const file of readdirSync('host'))list.push({relative:'cloud/'+file,content:readFileSync('host/'+file)});
for(const item of list){
  if(item.relative==='control/web/index.html')item.content=Buffer.from(item.content.toString().replaceAll('href="/style.css"','href="/control/style.css"').replaceAll('src="/agent.js"','src="/control/agent.js"').replaceAll('src="/app.js"','src="/control/app.js"'));
  if(item.relative==='control/web/app.js')item.content=Buffer.from(item.content.toString().replaceAll('http://127.0.0.1:5173','/').replaceAll('href="/"','href="/control/"').replaceAll('Local environment','Vercel-hosted demo'));
}
const report={startedAt:new Date().toISOString(),files:list.length,sourceHash:createHash('sha256').update(JSON.stringify(list.map(f=>[f.relative,createHash('sha256').update(f.content).digest('hex')]))).digest('hex'),steps:[]};
const sandbox=await Sandbox.get({name:'twodb-host-runtime'});
try{
  const drive=await Drive.getOrCreate({name:'twodb-application-data'});
  await sandbox.runCommand('true');
  await sandbox.update({ports:[8080],timeout:1800000,snapshotExpiration:0,keepLastSnapshots:{count:1},mounts:{'/persistent':drive},networkPolicy:'allow-all'});
  await sandbox.stop();
  await sandbox.runCommand('true');
  await sandbox.runCommand('mkdir',['-p',destination]);
  console.log('Uploading allowlisted application source; no local data, operator notes, Git history or credentials.');
  for(let i=0;i<list.length;i+=12)await sandbox.writeFiles(list.slice(i,i+12).map(f=>({path:destination+'/'+f.relative,content:f.content})));
  await sandbox.writeFiles([{path:'/home/vercel-sandbox/twodb-gateway-key',content:readFileSync('data/gateway-key.txt')}]);
  const setup=await sandbox.runCommand({cmd:'sh',args:['-c',`mkdir -p /persistent/market /persistent/controller /persistent/private; chmod 700 /persistent/private; ln -sfn /persistent/market ${destination}/data; ln -sfn /persistent/controller ${destination}/control/data; ln -sfn /persistent/private ${destination}/control/private`],sudo:true});
  if(setup.exitCode!==0)throw Error('Persistent paths failed');
  await sandbox.runCommand({cmd:'chown',args:['-R','1000:1000','/persistent'],sudo:true});
  await ensureDocker(sandbox);
  for(const [step,cmd,args] of [['dependencies','npm',['ci']],['market-build','npm',['run','build']],['isolated-image','npm',['run','control:agent:prepare']]]){
    console.log('Hosted step: '+step);
    const result=await sandbox.runCommand({cmd,args,cwd:destination,sudo:step==='docker',timeoutMs:900000});
    report.steps.push({step,exitCode:result.exitCode});
    mkdirSync('data',{recursive:true});
    writeFileSync('data/'+step+'.log',(await result.stdout())+(await result.stderr()));
    if(result.exitCode!==0)throw Error('Hosted step failed: '+step);
  }
  report.status='prepared';
  await sandbox.updateNetworkPolicy({allow:['api.openai.com']});
}catch(error){report.status='blocked';report.error=String(error.message);process.exitCode=1;}
finally{await sandbox.stop().catch(()=>{});report.finishedAt=new Date().toISOString();writeFileSync('data/provision.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
