import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
const root='/home/vercel-sandbox/twodb';
const key=readFileSync('/home/vercel-sandbox/twodb-gateway-key','utf8').trim();
const equals=(value)=> typeof value==='string' && Buffer.byteLength(value)===Buffer.byteLength(key) && timingSafeEqual(Buffer.from(value),Buffer.from(key));
let controller,market,boot;
const cleanEnv={PATH:process.env.PATH,HOME:process.env.HOME,NODE_EXTRA_CA_CERTS:process.env.NODE_EXTRA_CA_CERTS};
async function start(config) {
  if (!market || market.exitCode!==null) market=spawn(process.execPath,['--import','./cloud/market-port.mjs','--import','tsx','server/index.ts'],{cwd:root,env:cleanEnv,stdio:'ignore'});
  if (!controller || controller.exitCode!==null) {
    mkdirSync(root+'/control/private',{recursive:true});
    const file=root+'/control/private/engineer-key.json';
    if(!existsSync(file))writeFileSync(file,JSON.stringify({key:config.engineerKey}),{mode:0o600});
    controller=spawn(process.execPath,['--import','tsx','control/index.ts'],{cwd:root,env:{...cleanEnv,TWO_DB_OPENAI_API_KEY:config.apiKey,TWO_DB_AGENT_MODEL:config.model},stdio:'ignore'});
  }
  for(let i=0;i<100;i++) {
    const ready=await Promise.all([3003,3002].map(p=>fetch(`http://127.0.0.1:${p}/${p===3003?'api/health':'health'}`).then(r=>r.ok).catch(()=>false)));
    if(ready.every(Boolean))return;
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error('Backend startup failed');
}
const server=http.createServer(async(req,res)=>{
  if(!equals(req.headers['x-twodb-gateway'])) {res.writeHead(404).end();return;}
  if(req.url==='/__bootstrap' && req.method==='POST') {
    try {
      let body='';for await(const chunk of req){body+=chunk;if(body.length>12000)throw Error('Too large');}
      const config=JSON.parse(body);
      if(typeof config.engineerKey!=='string'||config.engineerKey.length<40||typeof config.apiKey!=='string'||typeof config.model!=='string')throw Error('Configuration missing');
      if(!boot)boot=start(config).finally(()=>{boot=undefined;});
      await boot;res.writeHead(200,{'content-type':'application/json'}).end('{"ok":true}');
    }catch {res.writeHead(503).end('Backend setup incomplete');}return;
  }
  const url=new URL(req.url,'http://internal');
  if(url.pathname.startsWith('/__')){res.writeHead(404).end();return;}
  const isControl=url.pathname==='/control'||url.pathname.startsWith('/control/')||url.pathname.startsWith('/engineer-api/');
  const port=isControl?3002:3003;
  const route=url.pathname.startsWith('/control')?(url.pathname.slice(8)||'/'):url.pathname;
  const headers={...req.headers,host:`127.0.0.1:${port}`};
  delete headers['x-twodb-gateway'];delete headers['x-forwarded-host'];delete headers['x-forwarded-for'];delete headers['forwarded'];
  if(headers.origin)headers.origin=`http://127.0.0.1:${port}`;
  const upstream=http.request({hostname:'127.0.0.1',port,path:route+url.search,method:req.method,headers},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Backend unavailable');});
  req.pipe(upstream);
});
server.listen(8080,'0.0.0.0');
server.on('error',e=>{if(e.code==='EADDRINUSE')process.exit(0);else process.exit(1);});
process.on('SIGTERM',()=>{controller?.kill('SIGTERM');market?.kill('SIGTERM');server.close();});
