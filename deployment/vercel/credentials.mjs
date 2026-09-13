import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
mkdirSync('data',{recursive:true});
for(const [name,file] of [['TWO_DB_CLOUD_GATEWAY_KEY','gateway-key.txt'],['TWO_DB_CLOUD_ENGINEER_KEY','engineer-key.txt']]){
  const target='data/'+file;
  if(!existsSync(target))writeFileSync(target,randomBytes(48).toString('base64url'),{mode:0o600});
  const value=readFileSync(target,'utf8');
  const code=await new Promise((resolve,reject)=>{
    const child=spawn('cmd.exe',['/d','/c','vercel.cmd','env','add',name,'production','--sensitive'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    // Never print CLI output or the secret; report only the exit status.
    child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('close',resolve);child.stdin.end(value);
  });
  console.log(name+': '+(code===0?'configured':'configuration command failed (possibly already present)'));
  if(code!==0)process.exitCode=1;
}
