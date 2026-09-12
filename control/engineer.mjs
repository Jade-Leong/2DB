import {readFileSync,existsSync} from 'node:fs';
const file=new URL('./private/engineer-key.json',import.meta.url);
if(!existsSync(file)){console.error('Start 2DB first with npm.cmd run control.');process.exitCode=1;}else{const {key}=JSON.parse(readFileSync(file,'utf8'));console.log('Local demo engineer key (paste into the 2DB session form):\n'+key+'\n\nThis grants local engineer review access. Keep it out of proposals, logs, and screenshots.');}
