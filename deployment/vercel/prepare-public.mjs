import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const deploymentRoot=path.dirname(fileURLToPath(import.meta.url));
const projectRoot=path.resolve(deploymentRoot,'../..');
const publicRoot=path.join(deploymentRoot,'public');
cpSync(path.join(projectRoot,'dist'),publicRoot,{recursive:true});
mkdirSync(path.join(publicRoot,'control'),{recursive:true});
for(const name of ['index.html','style.css','terminal.css','app.js','agent.js','account.js','terminal-motion.js']) {
  let source=readFileSync(path.join(projectRoot,'control/web',name),'utf8');
  if(name==='index.html')source=source.replaceAll('href="/style.css"','href="/control/style.css"').replaceAll('href="/terminal.css"','href="/control/terminal.css"').replaceAll('src="/agent.js"','src="/control/agent.js"').replaceAll('src="/account.js"','src="/control/account.js"').replaceAll('src="/terminal-motion.js"','src="/control/terminal-motion.js"').replaceAll('src="/app.js"','src="/control/app.js"');
  if(name==='app.js')source=source.replaceAll('href="/"','href="/control/"').replaceAll('http://127.0.0.1:3001','/').replaceAll('src="/brand-mark.svg"','src="/control/brand-mark.svg"').replaceAll('Local environment','Hosted test preview');
  writeFileSync(path.join(publicRoot,'control',name),source);
}
cpSync(path.join(projectRoot,'control/web/brand-mark.svg'),path.join(publicRoot,'control/brand-mark.svg'));
for(const file of [path.join(publicRoot,'index.html'),path.join(publicRoot,'control/index.html')]) {
  const source=readFileSync(file,'utf8');
  writeFileSync(file,source.replace('</head>','<link rel="stylesheet" href="/deployment-status.css"><script src="/deployment-status.js" defer></script></head>'));
}
writeFileSync(path.join(publicRoot,'deployment-status.css'),'.hosted-preview-status{position:relative;z-index:10000;background:#fff4cf;color:#493717;padding:10px 18px;font:13px/1.5 system-ui;text-align:center;border-bottom:1px solid #dfce92}.hosted-preview-status a{color:inherit;font-weight:700;margin-left:12px}');
writeFileSync(path.join(publicRoot,'deployment-status.js'),`const banner=document.createElement('div');banner.className='hosted-preview-status';banner.textContent='Demo environment · Purchases are simulated.';const link=document.createElement('a');link.href=location.pathname.startsWith('/control')?'/':'/control/';link.textContent=location.pathname.startsWith('/control')?'Loop Market':'2DB dashboard';banner.append(link);document.body.prepend(banner);`);
console.log('Public build prepared. Only compiled marketplace assets and dashboard web assets are exposed. Preview limitations are visible.');
