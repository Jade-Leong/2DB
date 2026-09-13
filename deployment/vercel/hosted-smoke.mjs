import {Sandbox} from '@vercel/sandbox';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ensureDocker} from './runtime.mjs';
const gateway=readFileSync('data/gateway-key.txt','utf8').trim();
const engineer=readFileSync('data/engineer-key.txt','utf8').trim();
let sandbox;
const report={startedAt:new Date().toISOString(),checks:[]};
async function boot(){
 sandbox=await Sandbox.get({name:'twodb-host-runtime'});await ensureDocker(sandbox);
 await sandbox.runCommand({cmd:'node',args:['/home/vercel-sandbox/twodb/cloud/gateway.mjs'],detached:true});
 const origin=sandbox.domain(8080);
 let response;
 for(let i=0;i<12;i++){
  response=await fetch(origin+'/__bootstrap',{method:'POST',headers:{'x-twodb-gateway':gateway,'content-type':'application/json'},body:JSON.stringify({apiKey:'',model:'gpt-5.4-nano',engineerKey:engineer}),signal:AbortSignal.timeout(30000)});
  if(response.ok)return origin;
  await new Promise(r=>setTimeout(r,1000));
 }
 throw Error('Hosted bootstrap failed: '+response.status);
}
function api(origin,url,method='GET',body,headers={}){return fetch(origin+url,{method,headers:{'x-twodb-gateway':gateway,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}
try{
 let origin=await boot();
 assert.equal((await fetch(origin+'/api/health')).status,404);report.checks.push('Direct sandbox access denied');
 assert.equal((await api(origin,'/api/health')).status,200);report.checks.push('Marketplace API ready');
 const items=await (await api(origin,'/api/products')).json();assert.ok(items.length>=6);
 const buyer={'x-demo-account':'buyer-maya'},requestKey='deployment-smoke-'+randomUUID();
 const response=await api(origin,'/api/checkout','POST',{items:[{productId:'p-knit',quantity:1}],code:'LOOP20',requestKey},buyer);
 assert.equal(response.status,201);const order=await response.json();
 const receipt=await (await api(origin,'/api/orders/'+order.id,'GET',undefined,buyer)).json();
 assert.equal(receipt.total_cents,3840);assert.equal(receipt.payment.amount_cents,4800);report.checks.push('Original discount defect preserved');
 assert.equal((await api(origin,'/api/orders/'+order.id,'GET',undefined,{'x-demo-account':'buyer-jamie'})).status,404);report.checks.push('Buyer isolation');
 assert.equal((await api(origin,'/engineer-api/inbox')).status,401);report.checks.push('Engineer API requires authorization');
 const login=await api(origin,'/engineer-api/login','POST',{key:engineer});assert.equal(login.status,200);report.checks.push('Hosted demo engineer login');
 await sandbox.stop();origin=await boot();
 const restored=await api(origin,'/api/orders/'+order.id,'GET',undefined,buyer);assert.equal(restored.status,200);report.checks.push('Order survives hosted restart');
 report.orderId=order.id;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.message);process.exitCode=1;}
finally{if(sandbox)await sandbox.stop().catch(()=>{});report.finishedAt=new Date().toISOString();writeFileSync('data/hosted-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
