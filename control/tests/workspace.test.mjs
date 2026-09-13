import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {createFixtureServer,scenarios} from './workspace-fixtures.mjs';
const fixture=createFixtureServer();
fixture.server.listen(0,'127.0.0.1');
await new Promise(resolve=>fixture.server.once('listening',resolve));
const origin=`http://127.0.0.1:${fixture.server.address().port}`;
const browser=await chromium.launch();
const artifacts='control/test-results/workspace';mkdirSync(artifacts,{recursive:true});
test.after(async()=>{await browser.close();await new Promise(resolve=>fixture.server.close(resolve));});
for(const scenario of scenarios) test(`workspace ${scenario}: truthful actions, expandable findings, no automatic runs`,async()=>{
 fixture.setScenario(scenario);const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(origin);await page.locator('.ticket').first().click();await page.locator('.next-action').waitFor();
  assert.equal(await page.locator('.terminal-hero').count(),0);
  assert.equal(await page.locator('[data-action="scripted-demo"], [data-action="create"], [data-action="check-tavily"]').count(),0);
  if(scenario==='idle') assert.equal(await page.getByRole('button',{name:'Start Agent 1 →',exact:true}).isEnabled(),true);
  if(scenario==='running') {assert.equal(await page.locator('[data-action="investigate"]').count(),0);assert.equal(await page.getByRole('button',{name:'Cancel investigation'}).isVisible(),true);}
  if(scenario==='proposal-ready') assert.equal(await page.getByRole('button',{name:'Start Agent 2 →',exact:true}).isEnabled(),true);
  if(scenario==='approved') assert.equal(await page.getByRole('button',{name:'Start Agent 2 →'}).isEnabled(),true);
  if(scenario==='verification-running') assert.equal(await page.getByRole('button',{name:'Cancel verification'}).isVisible(),true);
  if(scenario==='completed') {await page.getByRole('button',{name:'Review and approve →'}).click();assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).isVisible(),true);}
  if(scenario==='approved-queue') {await page.getByRole('button',{name:'Approved',exact:true}).click();assert.equal(await page.locator('.ticket').count(),1);assert.match(await page.locator('.next-heading').innerText(),/Approved for human PR work/);}
  if (await page.locator('[data-agent-detail="build"]').getAttribute('open') === null) await page.locator('[data-agent-detail="build"] > summary').click();
  await page.locator('[data-agent-detail="verify"] > summary').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${artifacts}/${scenario}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.inbox').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:/Inbox ·/}).click();assert.equal(await page.locator('.inbox').isVisible(),true);
  await page.getByRole('button',{name:'Selected ticket',exact:true}).click();assert.equal(await page.locator('.detail-column').isVisible(),true);
  await page.screenshot({path:`${artifacts}/${scenario}-mobile.png`,fullPage:true});assert.deepEqual(errors,[]);
  const sizes=await page.locator('.workspace').evaluate(el=>[...new Set([...el.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().height && [...n.childNodes].some(c=>c.nodeType===3 && c.textContent.trim())).map(n=>getComputedStyle(n).fontSize))].sort());
  assert.deepEqual(sizes,['13px','22px']);
  assert.equal(fixture.requests.some(r=>r.method!=='GET'),false);
 }finally{await page.close();}
});
test('polling preserves expanded review, focus and scroll at human approval',async()=>{
 fixture.setScenario('completed');const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 try {
  await page.goto(origin);await page.locator('.ticket').first().click();await page.getByRole('button',{name:'Review and approve →'}).click();
  const details=page.getByText('Revision details',{exact:true});await details.click();
  await page.getByRole('button',{name:'Approve',exact:true}).focus();
  const before=await page.locator('.detail-column').evaluate(el=>el.scrollTop);
  await page.evaluate(()=>refresh());
  assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await details.evaluate(el=>el.parentElement.open),true);
  assert.equal(await page.locator('.detail-column').evaluate(el=>el.scrollTop),before);
  assert.equal(await page.getByRole('button',{name:'Deny',exact:true}).isEnabled(),true);
  assert.equal(await page.locator('[data-action="changes"], #review-note').count(),0);
  await page.getByRole('button',{name:'Deny',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(fixture.requests.at(-1).path,'/engineer-api/proposals/fixture-proposal/reject');
 }finally{await page.close();}
});
test('read marker clears on opening a ticket and persists after reload',async()=>{
 fixture.setScenario('idle');const page=await browser.newPage({viewport:{width:1440,height:900}});
 try {
  await page.goto(origin);await page.locator('.ticket').first().waitFor();
  assert.equal(await page.locator('.inbox-count').innerText(),'10 unread\n0 approved');
  await page.locator('.ticket').first().click();await page.locator('.next-action').waitFor();
  assert.equal(await page.locator('.ticket').first().locator('.read-marker').innerText(),'Read');
  assert.match(await page.locator('.inbox-count').innerText(),/9 unread/);
  await page.reload();await page.locator('.ticket').first().waitFor();
  assert.equal(await page.locator('.ticket').first().locator('.read-marker').innerText(),'Read');
  assert.equal(await page.locator('.ticket').nth(1).locator('.read-marker').innerText(),'● Unread');
 }finally{await page.close();}
});
test('unread filter hides opened tickets and All restores them',async()=>{
 fixture.setScenario('idle');const page=await browser.newPage({viewport:{width:1440,height:900}});
 try {
  await page.goto(origin);await page.locator('.ticket').first().waitFor();
  await page.getByRole('button',{name:'Unread',exact:true}).click();
  assert.equal(await page.locator('.ticket').count(),10);
  await page.locator('.ticket').first().click();await page.locator('.next-action').waitFor();
  assert.equal(await page.locator('.ticket').count(),9);
  assert.equal(await page.locator('.ticket.is-read').count(),0);
  await page.getByRole('button',{name:'All',exact:true}).click();
  assert.equal(await page.locator('.ticket').count(),10);
  assert.equal(await page.locator('.ticket.chosen.is-read').count(),1);
 }finally{await page.close();}
});
