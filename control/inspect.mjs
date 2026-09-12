import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
for(const port of [3001,3002,5173]) await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{console.log(`${port}: occupied`);s.destroy();resolve();});s.once('error',()=>{console.log(`${port}: available`);resolve();});});
if(existsSync('data/local/market.sqlite')){const db=new DatabaseSync('data/local/market.sqlite',{readOnly:true});console.log(JSON.stringify(db.prepare('SELECT t.*,a.name,a.role FROM support_tickets t JOIN accounts a ON a.id=t.account_id').all()));db.close();}
const files={};
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const p=`${dir}/${entry.name}`;if(entry.isDirectory())walk(p);else files[p]=createHash('sha256').update(readFileSync(p)).digest('hex');}}
for(const p of ['src','server','public'])walk(p);
mkdirSync('control/data',{recursive:true});
if(!existsSync('control/data/original-source.json'))writeFileSync('control/data/original-source.json',JSON.stringify(files,null,2));
console.log(`Recorded ${Object.keys(files).length} original source/asset hashes.`);
