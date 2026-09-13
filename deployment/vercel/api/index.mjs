import {Sandbox} from '@vercel/sandbox';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {ensureDocker} from '../runtime.mjs';
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
  try { await sandbox.runCommand({cmd:'node',args:['/home/vercel-sandbox/twodb/cloud/gateway.mjs'],detached:true}); }
  catch { throw new HostedBackendError('gateway-start'); }
  const origin=sandbox.domain(8080);
  let response;
  try { response=await fetch(origin+'/__bootstrap',{method:'POST',headers:{'content-type':'application/json','x-twodb-gateway':process.env.TWO_DB_CLOUD_GATEWAY_KEY},body:JSON.stringify({apiKey:process.env.TWO_DB_OPENAI_API_KEY||'',model:process.env.TWO_DB_AGENT_MODEL||'',engineerKey:process.env.TWO_DB_CLOUD_ENGINEER_KEY,supabaseDbUrl:process.env.SUPABASE_DB_URL||''}),signal:AbortSignal.timeout(120000)}); }
  catch { throw new HostedBackendError('bootstrap-fetch'); }
  if(!response.ok)throw new HostedBackendError('bootstrap-response');
  cached={origin,at:Date.now()};
  return origin;
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(!process.env.TWO_DB_CLOUD_GATEWAY_KEY||!process.env.TWO_DB_CLOUD_ENGINEER_KEY){res.statusCode=503;res.end('Hosted credentials are not configured.');return;}
  if(req.headers.origin && req.headers.origin!==`https://${req.headers.host}`){res.statusCode=403;res.end('Cross-origin requests are not allowed.');return;}
  if(req.headers['sec-fetch-site']==='cross-site' && !['GET','HEAD'].includes(req.method)){res.statusCode=403;res.end('Cross-site requests are not allowed.');return;}
  const path=new URL(req.url,'https://internal').pathname;
  if(path.startsWith('/__')){res.statusCode=404;res.end();return;}
  try {
    if(!warming)warming=backend().finally(()=>{warming=undefined;});
    const origin=await warming;
    const headers={};
    for(const name of ['content-type','authorization','x-demo-account','origin','accept'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
    headers['x-twodb-gateway']=process.env.TWO_DB_CLOUD_GATEWAY_KEY;
    const chunks=[];let length=0;
    if(!['GET','HEAD'].includes(req.method)) {
      if(req.body!==undefined)chunks.push(Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body)));
      else for await(const chunk of req){length+=chunk.length;if(length>2200000){res.statusCode=413;res.end('Request too large');return;}chunks.push(chunk);}
      if(chunks.reduce((total,chunk)=>total+chunk.length,0)>2200000){res.statusCode=413;res.end('Request too large');return;}
    }
    const response=await fetch(origin+req.url,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,redirect:'manual',signal:AbortSignal.timeout(55000)});
    res.statusCode=response.status;
    for(const name of ['content-type','content-security-policy','x-content-type-options','location'])if(response.headers.has(name))res.setHeader(name,response.headers.get(name));
    if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
  }catch(error){
    cached=undefined;
    const stage=error instanceof HostedBackendError?error.stage:'proxy';
    console.error(`2DB hosted backend unavailable at ${stage}`);
    if(!res.headersSent){res.statusCode=503;res.setHeader('X-2DB-Backend-Stage',stage);res.end('The hosted backend is starting or unavailable. Retry shortly.');}else res.destroy();
  }
}
