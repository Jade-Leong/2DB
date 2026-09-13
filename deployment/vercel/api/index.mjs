import {Sandbox} from '@vercel/sandbox';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {ensureDocker} from '../runtime.mjs';
function jsonError(res,status,message) {
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify({error:message}));
}
let warming;
let cached;
class HostedBackendError extends Error {
  constructor(stage) { super(stage); this.stage=stage; }
}
async function backend() {
  if(cached && Date.now()-cached.at<20000)return cached.origin;
  let sandbox;
  try { sandbox=await Sandbox.get({name:'twodb-host-runtime'}); }
  catch { throw new HostedBackendError('sandbox-get'); }
  try { await ensureDocker(sandbox); }
  catch { throw new HostedBackendError('docker-ready'); }
  const allowedHosts=['api.openai.com','api.elevenlabs.io','jcynpdtvuqrppkkgegbt.supabase.co'];
  if(process.env.SUPABASE_DB_URL){try{allowedHosts.push(new URL(process.env.SUPABASE_DB_URL).hostname);}catch{throw new HostedBackendError('supabase-config');}}
  try { await sandbox.updateNetworkPolicy({allow:[...new Set(allowedHosts)]}); }
  catch { throw new HostedBackendError('network-policy'); }
  try { await sandbox.runCommand({cmd:'node',args:['/home/vercel-sandbox/twodb/cloud/gateway.mjs'],detached:true}); }
  catch { throw new HostedBackendError('gateway-start'); }
  const origin=sandbox.domain(8080);
  let response;
  try { response=await fetch(origin+'/__bootstrap',{method:'POST',headers:{'content-type':'application/json','x-twodb-gateway':process.env.TWO_DB_CLOUD_GATEWAY_KEY},body:JSON.stringify({apiKey:process.env.TWO_DB_OPENAI_API_KEY||'',model:process.env.TWO_DB_AGENT_MODEL||'',engineerKey:process.env.TWO_DB_CLOUD_ENGINEER_KEY,supabaseDbUrl:process.env.SUPABASE_DB_URL||'',supabaseUrl:process.env.SUPABASE_URL||'',supabasePublishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||'',elevenLabsApiKey:process.env.ELEVENLABS_API_KEY||'',elevenLabsAgentId:process.env.ELEVENLABS_AGENT_ID||''}),signal:AbortSignal.timeout(120000)}); }
  catch { throw new HostedBackendError('bootstrap-fetch'); }
  if(!response.ok)throw new HostedBackendError('bootstrap-response');
  cached={origin,at:Date.now()};
  return origin;
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(!process.env.TWO_DB_CLOUD_GATEWAY_KEY||!process.env.TWO_DB_CLOUD_ENGINEER_KEY){jsonError(res,503,'Hosted credentials are not configured.');return;}
  if(req.headers.origin && req.headers.origin!==`https://${req.headers.host}`){jsonError(res,403,'Cross-origin requests are not allowed.');return;}
  if(req.headers['sec-fetch-site']==='cross-site' && !['GET','HEAD'].includes(req.method)){jsonError(res,403,'Cross-site requests are not allowed.');return;}
  const path=new URL(req.url,'https://internal').pathname;
  if(path.startsWith('/__')){jsonError(res,404,'Not found.');return;}
  try {
    if(!warming)warming=backend().finally(()=>{warming=undefined;});
    const origin=await warming;
    const headers={};
    for(const name of ['content-type','authorization','x-demo-account','origin','accept'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
    headers['x-twodb-gateway']=process.env.TWO_DB_CLOUD_GATEWAY_KEY;
    const chunks=[];let length=0;
    if(!['GET','HEAD'].includes(req.method)) {
      if(req.body!==undefined)chunks.push(Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body)));
      else for await(const chunk of req){length+=chunk.length;if(length>2200000){jsonError(res,413,'Request too large');return;}chunks.push(chunk);}
      if(chunks.reduce((total,chunk)=>total+chunk.length,0)>2200000){jsonError(res,413,'Request too large');return;}
    }
    const response=await fetch(origin+req.url,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,redirect:'manual',signal:AbortSignal.timeout(55000)});
    if(!response.ok && !(response.headers.get('content-type')||'').includes('application/json')) {
      await response.body?.cancel();
      jsonError(res,response.status,response.status>=500?'The hosted backend is starting or unavailable. Retry shortly.':'The request could not be completed. Please try again.');
      return;
    }
    res.statusCode=response.status;
    for(const name of ['content-type','content-security-policy','x-content-type-options','location'])if(response.headers.has(name))res.setHeader(name,response.headers.get(name));
    if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
  }catch(error){
    cached=undefined;
    const stage=error instanceof HostedBackendError?error.stage:'proxy';
    console.error(`2DB hosted backend unavailable at ${stage}`);
    if(!res.headersSent){res.setHeader('X-2DB-Backend-Stage',stage);jsonError(res,503,'The hosted backend is starting or unavailable. Retry shortly.');}else res.destroy();
  }
}
