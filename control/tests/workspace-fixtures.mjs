import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../web/', import.meta.url));
export const scenarios = ['idle', 'running', 'proposal-ready', 'approved', 'verification-running', 'failed', 'completed', 'inconclusive', 'approved-queue'];
export function fixtureData(scenario = 'idle') {
  const t = { id: 'fixture-checkout', customer_name: 'Maya Chen', customer_id: 'fixture-buyer', customer_role: 'buyer', submitted_at: new Date(Date.now()-8*60000).toISOString(), subject: 'Checkout discount is missing from payment', complaint: 'I used LOOP20 on the $48 knit. Checkout showed $38.40, but the payment was $48.00. Please investigate the mismatch.' };
  const tickets = [t, ...Array.from({length: 9}, (_, i) => ({...t, id: `fixture-${i}`, customer_name: ['Alex Rivera', 'Jordan Park', 'Sam Lee'][i%3], subject: ['Order missing from purchase history', 'Product photo disappears after upload', 'Cart total changes after refresh'][i%3], complaint: 'The page shows a different result after I refresh. Can you check what happened?', submitted_at: new Date(Date.now()-(i+1)*3600000).toISOString()}))];
  const hasProposal = !['idle','running'].includes(scenario);
  const verifying = scenario === 'verification-running';
  const result = ({failed:'Failed',completed:'Verified awaiting engineer review',inconclusive:'Inconclusive','approved-queue':'Approved'})[scenario];
  const approved = hasProposal && scenario !== 'proposal-ready';
  const run = scenario === 'idle' ? null : { id:'fixture-investigation', ticket_id:t.id, state: scenario === 'running' ? 'Model response' : 'Proposal ready', message: scenario === 'running' ? 'Inspecting how checkout passes the discounted total to payment.' : 'Proposed a change to use the discounted amount when creating the payment.', started_at:new Date(Date.now()-120000).toISOString(), finished_at: scenario === 'running' ? null : new Date().toISOString(), evidence:[{at:new Date().toISOString(), screenshot:'fixture.png',record:'fixture.json', displayedCents:3840,orderCents:3840,paymentCents:4800}], events:[{state:'Reproducing',message:'Captured checkout and payment totals in the browser.',at:new Date(Date.now()-90000).toISOString()},{state:'Reading source',message:'Reading the payment handler and discount calculation.',at:new Date(Date.now()-30000).toISOString(),details:{file:'server/payments.ts'}}],usage:{input_tokens:100,output_tokens:50},proposal_id:hasProposal?'fixture-proposal':null };
  const p = hasProposal ? { id:'fixture-proposal',ticket_id:t.id,ticket:t,kind:'agent-generated',author:'Agent 1',state: result || (verifying ? 'Live Agent 2 running' : approved ? 'Authorized for verification':'Ready for Agent 2'),revision_number:1,candidate_revision:'c'.repeat(64),base_revision:'b'.repeat(64),requirements_hash:'r'.repeat(64),harness_hash:'h'.repeat(64),current_approval:approved?'fixture-approval':null,last_run:verifying||result?'fixture-verification':null,approvals:approved?[{id:'fixture-approval',revision:'c'.repeat(64),revision_number:1,reviewer:'Controller verification authorization',created_at:new Date().toISOString()}]:[],queueApproval:scenario==='approved-queue'?{reviewer:'Fixture engineer',created_at:new Date().toISOString(),revision:'c'.repeat(64),revision_number:1}:null,explanation:'Pass the discounted order total into the payment request so the charge matches checkout.',diff:'--- a/server/payments.ts\n+++ b/server/payments.ts\n- amount: subtotalCents,\n+ amount: order.totalCents,',agentMetadata:{conclusion:{likelyCause:'The payment handler uses the subtotal before the discount is applied.',uncertainties:'Other payment methods have not been evaluated.',sourceReferences:['server/payments.ts']},expected:'The charged total should match checkout.',research:{summary:'SQLite documentation confirms that the application-supplied bound value is what the payment insert stores.',citations:[{id:'web-1',stage:'extract',url:'https://nodejs.org/api/sqlite.html',title:'Node.js SQLite documentation',quote:'Prepared statements are parameterizable',relationship:'supports',relevance:'This supports tracing the incorrect amount to the value selected by the payment handler rather than an implicit database calculation.'}]}},requirements:[{id:'total-match',title:'Charged total matches checkout',expected:3840}],activity:[],runs:[]} : null;
  if (p && (verifying || result)) p.runs=[{id:'fixture-verification',state:scenario==='approved-queue'?'Verified awaiting engineer review':p.state,revision_number:1,candidate_revision:p.candidate_revision,base_revision:p.base_revision,requirements_hash:p.requirements_hash,harness_hash:p.harness_hash,approval_id:p.current_approval,verification_mode:'live-agent-2',started_at:new Date(Date.now()-30000).toISOString(),finished_at:verifying?null:new Date().toISOString(),message:verifying?'Comparing the baseline and candidate checkout results.':result==='Failed'?'The candidate still charges the full amount.':result==='Inconclusive'?'The browser session ended before all checks completed.':'The checkout amount and payment match in the candidate.',evidence:verifying?null:Object.fromEntries(['baseline','candidate'].map(env=>[env,{typecheck:{exitCode:0},build:{exitCode:0},required:{exitCode:env==='candidate'&&['completed','approved-queue'].includes(scenario)?0:1,assessment:{checks:[{id:'total-match',status:env==='candidate'&&['completed','approved-queue'].includes(scenario)?'passed':'failed',observed:env==='candidate'&&['completed','approved-queue'].includes(scenario)?3840:4800}]},report:{tests:[]}}}]))}];
  return {tickets,run,p};
}
export function createFixtureServer(initial='idle', showBanner=false) {
  let scenario=initial, health=true;
  const requests=[];
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const respond=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname==='/api/health') return respond(health?{ok:true,app:'2DB'}:{error:'offline'},health?200:503);
    if(url.pathname.startsWith('/engineer-api/') || url.pathname.startsWith('/auth-api/')) {
      requests.push({method:req.method,path:url.pathname});
      const {tickets,run,p}=fixtureData(scenario);
      if(req.method!=='GET') return respond({error:'Read-only UI fixtures: no agents can run here.'},409);
      const route=url.pathname.replace('/engineer-api','');
      const data=route==='/inbox'?tickets:route==='/tickets'?[]:route==='/proposals'?(p?[p]:[]):route==='/proposals/fixture-proposal'?p:route==='/investigations'?(run?[run]:[]):route==='/investigations/fixture-investigation'?run:route==='/scripted-investigations'?[]:route==='/test-summary'?null:route==='/agent/status'||route==='/agent2/status'?{state:'Ready'}:route==='/session'?{reviewer:'Fixture engineer'}:url.pathname==='/auth-api/config'?{enabled:true}:{};
      return respond(data);
    }
    if(url.pathname==='/' && scenarios.includes(url.searchParams.get('scenario'))) scenario=url.searchParams.get('scenario');
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','app.js','agent.js','workspace.js','account.js','terminal-motion.js','style.css','terminal.css','brand-mark.svg'].includes(name)) {res.writeHead(404);return res.end();}
    let content=readFileSync(path.join(web,name));
    if(name==='index.html') content=content.toString().replace('<div id="app">',`<script>sessionStorage.setItem('2db-engineer-session','isolated-ui-fixture');</script>${showBanner?`<div style="padding:12px;color:#dfc38a;font:13px monospace">UI PREVIEW · isolated sample data · no live agents ${scenarios.map(s=>`<a style="color:#a8d5b5;margin-left:12px" href="/?scenario=${s}">${s}</a>`).join('')}</div>`:''}<div id="app">`);
    res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html');res.end(content);
  });
  return {server,requests,setScenario(value){scenario=value;},setHealth(value){health=value;}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const {server}=createFixtureServer('proposal-ready',true);
 server.listen(3004,'127.0.0.1',()=>console.log('Isolated workspace preview: http://127.0.0.1:3004/'));
}
