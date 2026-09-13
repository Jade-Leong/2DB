import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const origin='https://twodb-steel.vercel.app';
const report={origin,startedAt:new Date().toISOString(),checks:[]};
const request=(url,options={})=>fetch(origin+url,{...options,signal:AbortSignal.timeout(65000)});
try{
 for(const path of ['/','/control/']){const response=await request(path);assert.equal(response.status,200,path);assert.ok((await response.text()).includes('deployment-status.js'));report.checks.push(path+' page served');}
 const health=await request('/api/health');assert.equal(health.status,200,'public API health');assert.equal((await health.json()).ok,true);report.checks.push('Public marketplace API');
 const products=await (await request('/api/products')).json();assert.ok(products.length>=6);report.checks.push('Products returned');
 assert.equal((await request('/engineer-api/inbox')).status,401);report.checks.push('Public engineer API requires login');
 assert.equal((await request('/engineer-api/login',{method:'POST',headers:{origin:'https://unrelated.example','content-type':'application/json'},body:'{}'})).status,403);report.checks.push('Cross-origin login rejected');
 const login=await request('/engineer-api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:readFileSync('data/engineer-key.txt','utf8').trim()})});assert.equal(login.status,200,'engineer login');
 const {token}=await login.json();const headers={authorization:'Bearer '+token};
 assert.equal((await request('/engineer-api/inbox',{headers})).status,200);report.checks.push('Authenticated inbox');
 const status=await (await request('/engineer-api/agent/status',{headers})).json();report.agentSetup=status.state;
 for(const file of ['/runtime.mjs','/.env.local','/data/engineer-key.txt','/host/gateway.mjs','/control/private/engineer-key.json'])assert.equal((await request(file)).status,404,file);
 report.checks.push('Private deployment files not served');
 await request('/engineer-api/logout',{method:'POST',headers});
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.message);process.exitCode=1;}
report.finishedAt=new Date().toISOString();writeFileSync('data/public-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
