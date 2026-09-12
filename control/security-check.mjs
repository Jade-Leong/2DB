for(const pathname of ['/control/private/engineer-key.json','/control/web/app.js','/operator/BUGS.md','/verification/control-discount.spec.ts']){
 const response=await fetch('http://127.0.0.1:5173'+pathname);
 console.log(`${pathname}: HTTP ${response.status}`);
 if(response.status!==403)throw new Error('Marketplace development server must deny private/controller files.');
 await response.body?.cancel();
}
console.log('Private/controller paths are blocked by the marketplace dev server.');
