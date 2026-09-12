import {readdirSync,statSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./data/controller-tests/',import.meta.url));
const latest=readdirSync(root).map(name=>path.join(root,name)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];
const runs=path.join(latest,'controller/runs');
if(existsSync(runs))for(const run of readdirSync(runs)){console.log(`Run ${run}`);for(const env of ['baseline','candidate'])for(const suite of ['required','known-unresolved']){const file=path.join(runs,run,env,suite,'results.json');if(existsSync(file)){const r=JSON.parse(readFileSync(file,'utf8'));console.log(`${env} ${suite}: ${r.status}; ${r.tests.map(t=>`${t.id}=${t.status}`).join(', ')}`);}}}
