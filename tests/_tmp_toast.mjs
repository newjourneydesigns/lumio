import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const ROOT='/home/user/lumio';
const PORT=8177;
const FIXTURE=ROOT+'/tests/fixtures/phrase-forward.wav';
const CHROME=process.env.CHROME_PATH||'/opt/pw-browsers/chromium';
const server=spawn(process.execPath,[ROOT+'/scripts/serve.js'],{env:{...process.env,PORT:String(PORT)},stdio:'ignore'});
await new Promise(r=>setTimeout(r,800));
const browser=await chromium.launch({executablePath:CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${FIXTURE}`,'--autoplay-policy=no-user-gesture-required']});
const sizes=[{w:844,h:390,name:'landscape 844x390'},{w:390,h:844,name:'portrait 390x844'},{w:320,h:568,name:'portrait 320x568'}];
for (const s of sizes){
const context=await browser.newContext({permissions:['microphone'],viewport:{width:s.w,height:s.h},hasTouch:true,isMobile:false});
const page=await context.newPage();
await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
const stepBtn=(n)=>page.locator(`.step[data-step="${n}"] .step-primary`);
async function measure(label){
  // wait for scroll to settle
  await page.evaluate(()=>new Promise(res=>{let last=-1,same=0;const t=()=>{const y=window.scrollY;if(y===last)same++;else same=0;last=y;if(same>4)return res();requestAnimationFrame(t);};requestAnimationFrame(t);}));
  const data = await page.evaluate((step)=>{
    const toast=document.getElementById('toast');
    const btn=document.querySelector(`.step[data-step="${step}"] .step-primary`);
    const tr=toast.getBoundingClientRect(), br=btn.getBoundingClientRect();
    const vh=innerHeight;
    const visTop=Math.max(0,br.top), visBot=Math.min(vh,br.bottom);
    const samples=[];
    for(let i=0;i<8;i++){
      const y=visTop+(visBot-visTop)*(i+0.5)/8;
      const el=document.elementFromPoint(br.left+br.width/2,y);
      samples.push(el===toast?'TOAST':(el===btn?'btn':(el?el.className||el.tagName:'null')));
    }
    return {toastHidden:toast.hidden, toastPE:getComputedStyle(toast).pointerEvents,
      toast:{t:Math.round(tr.top),b:Math.round(tr.bottom),l:Math.round(tr.left),r:Math.round(tr.right)},
      btn:{t:Math.round(br.top),b:Math.round(br.bottom),l:Math.round(br.left),r:Math.round(br.right)},
      visible:Math.round(visBot-visTop), vh, disabled:btn.disabled, samples,
      scrollY:Math.round(scrollY), maxScroll: Math.round(document.documentElement.scrollHeight-innerHeight)};
  },label.step);
  console.log(s.name,'|',label.name,JSON.stringify(data));
}
async function record(n,ms){
  await stepBtn(n).click();
  await page.waitForSelector(`.step[data-step="${n}"] .step-primary.is-live`,{timeout:8000});
  await page.waitForTimeout(ms);
  await stepBtn(n).click();
  await page.waitForFunction((st)=>document.querySelector(`.step[data-step="${st}"]`).dataset.state==='done',n,{timeout:8000});
}
await record(1,1200);
await measure({name:'after step1 toast, step2 btn',step:2});
await page.waitForTimeout(2800);
await stepBtn(2).click();
await page.waitForFunction(()=>!window.__sdrawkcab.busy,null,{timeout:15000});
await record(3,1200);
await measure({name:'after step3 toast, step4 btn',step:4});
await context.close();
}
await browser.close();
server.kill();
