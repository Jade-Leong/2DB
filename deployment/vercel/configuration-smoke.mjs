import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin='https://twodb-steel.vercel.app';
const report={origin,startedAt:new Date().toISOString(),checks:[]};
async function request(route,options={}) {
  const response=await fetch(origin+route,{...options,signal:AbortSignal.timeout(65000)});
  assert.equal(response.status,200,route+' HTTP '+response.status);
  return response.json();
}
try {
  const health=await request('/api/health');
  assert.equal(health.ok,true);assert.equal(health.database,'supabase');
  report.checks.push('Hosted marketplace reads Supabase');
  const products=await request('/api/products');assert.ok(products.length>=6);
  report.checks.push('Supabase products returned');
  const accounts=await request('/auth-api/config');assert.equal(accounts.enabled,true);
  report.checks.push('Account sign-in configuration enabled (not a user-login test)');
  const headers={'x-demo-account':'buyer-maya'};
  const voice=await request('/api/support/voice/status',{headers});assert.equal(voice.available,true);
  report.checks.push('Voice configuration reaches marketplace backend');
  const session=await request('/api/support/voice/session',{method:'POST',headers});
  assert.equal(new URL(session.signedUrl).protocol,'wss:');
  assert.equal(new URL(session.signedUrl).hostname,'api.elevenlabs.io');
  report.checks.push('ElevenLabs signed-session exchange passed (no audio conversation started)');
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error.message);process.exitCode=1;}
report.finishedAt=new Date().toISOString();mkdirSync('data',{recursive:true});
writeFileSync('data/configuration-smoke.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
