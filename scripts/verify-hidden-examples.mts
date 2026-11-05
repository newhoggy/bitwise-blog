// Optional live verification: install Playwright outside the site, then set
// BH_PLAYWRIGHT_MODULE to its index.mjs (or make playwright resolvable).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium, firefox } = await import(process.env.BH_PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { serveStatic, findChrome } from './chrome.mts';
import type { AddressInfo } from 'node:net';
// Playwright is installed outside the site (see above), so it has no types here: its pages are `any`.
type Page = any;
// Globals of the pages under test, used inside the callbacks that `page.evaluate` runs in the browser.
declare const document: any, window: any, getComputedStyle: any, innerWidth: number, sessionStorage: any, bhExamples: any;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output=path.resolve(process.env.BH_LIVE_OUTPUT || path.join(root,'.visual/hidden-examples-live'));
const base='https://bitwise.john-ky.io/';
const actual=fs.readdirSync(root+'/docs').filter(f=>f.endsWith('.html')&&fs.readFileSync(root+'/docs/'+f,'utf8').includes('<meta name="bh:example" content="true">'));
console.log('EXAMPLES',actual);
const results:Record<string,unknown>[]=[];
const server=await serveStatic(root);
fs.mkdirSync(output,{recursive:true});
async function checkHome(page:Page,shown:boolean){
 const cards=await page.locator('#doc-list > li:visible').count(); assert.equal(cards,shown?7:3);
 const chips=await page.locator('bh-filter button:visible').allTextContents();
 for(const chip of ['Examples','Decision','Design'])assert.equal(chips.includes(chip),shown,JSON.stringify(chips));
 await page.keyboard.press('Meta+k');
 await page.waitForFunction(()=>document.querySelector('.bh-search-status')?.textContent.includes('documents'));
 const status=await page.locator('.bh-search-status').innerText();
 // All three ordinary pages appear in empty-query results.
 assert.match(status,new RegExp('^'+(shown?7:3)+' documents'));
 for(const query of ['ADR-001','ADR-002','Moving rate limiting','Token bucket']){
  await page.locator('.bh-search-input').fill(query);
  const hrefs=await page.locator('.bh-search-results a').evaluateAll((es:any[])=>es.map(e=>e.href));
  const hits=hrefs.filter((h:string)=>actual.some(f=>h.includes('/docs/'+f)));
  if(shown)assert(hits.length>0,query); else assert.equal(hits.length,0,query);
 }
 await page.keyboard.press('Escape');
 return {cards,chips,emptySearch:status};
}
try{
for(const engine of ['chrome','firefox']){
 const browser=await (engine==='chrome'?chromium.launch({executablePath:findChrome()}):firefox.launch());
 console.log('BROWSER',engine,browser.version());
 try{for(const width of [1280,390])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});
  const page=await context.newPage(); const errors:unknown[]=[];page.on('pageerror',(e:Error)=>errors.push({url:page.url(),message:e.message,stack:e.stack}));
  const goto=async (url:string)=>{const response=await page.goto(url);assert.equal(response.status(),200);await page.waitForSelector('html[data-bh-ready]',{state:'attached'});};
  const label=engine+'-'+width+'-'+theme;
  const observation:Record<string,unknown>={label,version:browser.version(),errors};
  try{
   await goto(base); assert.equal(await (await context.request.get(base+'theme/examples.js')).text(),fs.readFileSync(root+'/theme/examples.js','utf8'));
   assert.equal(await page.evaluate(()=>innerWidth),width);
   const home=observation.home=await checkHome(page,false);
   await page.screenshot({path:output+'/'+label+'-home.png'});
   for(const file of actual){
    await goto(base+'docs/'+file);
    assert.equal(await page.locator('main h1').innerText(),'This is an example page');
    assert.equal(await page.locator('main.bh-example-blocked').count(),1);
    assert.equal(await page.evaluate(()=>innerWidth),width);
    const posts=page.getByRole('link',{name:'See the posts'}); await posts.click();
    await page.waitForSelector('#doc-list'); assert.equal(await page.locator('#doc-list > li:visible').count(),3);
   }
   await goto(base+'docs/token-bucket-rate-limiting.html');
   await page.screenshot({path:output+'/'+label+'-notice.png'});
   await goto(base+'docs/glossary.html');
   for(const id of ['rate-limiting','token-bucket'])assert.equal(await page.locator('#'+id+' + dd a[href*="token-bucket-rate-limiting.html"]').count(),0);
   await goto(base+'?examples'); const override=observation.override=await checkHome(page,true);
   await goto(base+'docs/token-bucket-rate-limiting.html');assert.equal(await page.locator('main.bh-example-blocked').count(),0);
   assert.equal(await page.evaluate(()=>bhExamples.source),'session');
   await goto(base+'?examples=auto');await checkHome(page,false);assert.equal(await page.evaluate(()=>sessionStorage.getItem('bh-examples')),null);
   const local='http://localhost:'+(server.address() as AddressInfo).port+'/index.html';
   await goto(local+'?examples=off'); await checkHome(page,false);
   await goto(local);await checkHome(page,false);assert.equal(await page.evaluate(()=>bhExamples.source),'session');
   await goto(local+'?examples=auto');await checkHome(page,false);assert.equal(await page.evaluate(()=>sessionStorage.getItem('bh-examples')),null);
   observation.behavior='PASS';
   assert.deepEqual(errors,[]);
   results.push({label,version:browser.version(),home,override,status:'PASS'});console.log('PASS',label,JSON.stringify(home));
  }catch(e){results.push({...observation,status:'FAIL',message:(e as Error).stack});console.log('FAIL',label,(e as Error).stack);}
  finally{await context.close();}
 }
 // Hold initialization until after the early state is sampled; always unblock navigation.
 const context=await browser.newContext();
 let release:(value?:unknown)=>void=()=>{};
 try {
  const page=await context.newPage();
  const gate=new Promise(r=>release=r);
  await page.route('**/theme/bh.js',async (route:any)=>{await gate;await route.continue();});
  const nav=page.goto(base+'docs/token-bucket-rate-limiting.html',{waitUntil:'domcontentloaded'});
  // Observe a navigation rejection immediately, including when an early-state wait is pending.
  const navigation=nav.then(()=>null,(e:unknown)=>e);
  let early:any;
  try {
   await page.waitForFunction(()=>document.querySelector('main')&&window.bhExamples&&getComputedStyle(document.querySelector('main')).display==='none');
   early=await page.evaluate(()=>({policy:bhExamples.visible,display:getComputedStyle(document.querySelector('main')).display,notice:!!document.querySelector('.bh-example-blocked')}));
  } finally { release(); }
  const error=await navigation;
  if(error) throw error;
  await page.waitForSelector('.bh-example-blocked');
  assert.equal(early.policy,false);assert.equal(early.display,'none');assert.equal(early.notice,false);
  results.push({label:engine+'-delayed-initialization',early,status:'PASS'});
  console.log('PASS',engine,'early',early);
 } catch(e) {
  results.push({label:engine+'-delayed-initialization',status:'FAIL',message:(e as Error).stack});
  console.log('FAIL',engine,'early',(e as Error).stack);
 } finally {release();await context.close();}
 }finally{await browser.close();}
}
}finally{server.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));}
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
