import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve(import.meta.dirname,'../..'), out=resolve(root,'dist');
const server=createServer(async(req,res)=>{
  try {const p=new URL(req.url,'http://local').pathname;
    if(!p.startsWith('/preview/')||p.includes('..'))throw Error('Invalid path');
    const file=resolve(out,p.slice(9)||'index.html');if(!file.startsWith(out+'/'))throw Error('Invalid path');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const report={checkedAt:new Date().toISOString(),browser:browser.version(),mocked:false,transactionsBroadcast:0,errors:[],resourceFailures:[],result:'pending'};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('requestfailed',r=>report.resourceFailures.push({url:r.url(),error:r.failure()?.errorText}));
 await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
 await page.getByText('ABI hashes, chain and code checked',{exact:true}).waitFor({timeout:55000});
 await page.screenshot({path:resolve(root,'docs/evidence/desktop-live.png'),fullPage:true});
 report.result='pass';report.liveState=await page.locator('.pool-strip').innerText();report.launchWindow=await page.locator('.window-panel').innerText();
} catch(e) {report.result='unavailable';report.error=e.message;process.exitCode=1;}
finally {await writeFile(resolve(root,'docs/evidence/live-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
