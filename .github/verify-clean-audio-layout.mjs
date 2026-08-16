import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const base = 'http://127.0.0.1:4173/';
async function catalog(p){return p.evaluate(async()=> (await (await fetch('/audio/snac/catalog.json')).json()).entries)}
async function seed(p,id,subtitles=false){
  await p.goto(base,{waitUntil:'domcontentloaded'});
  await p.evaluate(({id,subtitles})=>{
    localStorage.setItem('em-board-audio-player-v2',JSON.stringify({sourceId:id,position:12,rate:1,expanded:true,stowed:false,continuousPlay:true,queueIds:[],randomReview:false}));
    localStorage.setItem('em-board-audio-subtitles-v1',subtitles?'true':'false');
  },{id,subtitles});
  await p.reload({waitUntil:'domcontentloaded'});
  await p.locator('.audio-player-dock').waitFor({state:'visible',timeout:30000});
  await p.locator('.audio-section-companion').waitFor({state:'visible',timeout:30000});
  await p.waitForTimeout(350);
}
const same=(a,b,t=.75)=>Math.abs(a-b)<=t;
const dc=await browser.newContext({viewport:{width:1440,height:900}});const p=await dc.newPage();await p.goto(base,{waitUntil:'domcontentloaded'});const entries=await catalog(p);const src=entries.find(e=>e.kind==='textbook-chapter'||e.kind==='textbook-section');assert.ok(src);await seed(p,src.id,false);
const dock=p.locator('.audio-player-dock');const timeline=p.locator('.audio-player-timeline');const input=p.locator('.audio-player-timeline > input[type="range"]');const layer=p.locator('.audio-section-node-layer');
const baseDock=await dock.boundingBox(), baseTimeline=await timeline.boundingBox(), ib=await input.boundingBox(), lb=await layer.boundingBox();assert.ok(baseDock&&baseTimeline&&ib&&lb);assert.ok(same(ib.height,18,.5));assert.ok(same(ib.y,lb.y,.5));
await p.screenshot({path:'visual-proof/01-desktop-base.png',fullPage:false});
await p.locator('.audio-player-settings > summary').click();assert.equal(await p.locator('.audio-player-subtitle-option').count(),1);const settingsTimeline=await timeline.boundingBox();assert.ok(settingsTimeline&&same(settingsTimeline.y,baseTimeline.y)&&same(settingsTimeline.height,baseTimeline.height));await p.screenshot({path:'visual-proof/02-desktop-settings.png',fullPage:false});await p.locator('.audio-player-subtitle-option').click();await p.locator('.audio-player-settings > summary').click();await p.locator('.audio-subtitle-float').waitFor({state:'visible',timeout:10000});const subtitleDock=await dock.boundingBox(), subtitleBox=await p.locator('.audio-subtitle-float').boundingBox();assert.ok(subtitleDock&&subtitleBox);assert.ok(same(subtitleDock.width,baseDock.width)&&same(subtitleDock.height,baseDock.height));assert.ok(subtitleBox.y+subtitleBox.height<=subtitleDock.y+2);assert.equal(await p.locator('.audio-subtitle-line.is-current').count(),1);await p.screenshot({path:'visual-proof/03-desktop-subtitles.png',fullPage:false});
const beforeSeek=Number(await input.inputValue());const next=p.locator('.audio-subtitle-line.is-next').first();if(await next.count()){await next.click();await p.waitForTimeout(80);assert.notEqual(Number(await input.inputValue()),beforeSeek)}
const beforeSection=await dock.boundingBox();await p.locator('.audio-section-toggle').click();await p.waitForTimeout(100);const afterSection=await dock.boundingBox(), panel=await p.locator('.audio-section-panel-floating').boundingBox();assert.ok(beforeSection&&afterSection&&panel);console.log('desktop section geometry',JSON.stringify({beforeSection,afterSection,panel}));assert.ok(same(afterSection.width,beforeSection.width)&&same(afterSection.height,beforeSection.height));assert.ok(panel.x>=afterSection.x+afterSection.width+8);assert.ok(panel.y>=16&&panel.y+panel.height<=884);assert.equal(await timeline.isVisible(),true);assert.equal(await p.locator('.audio-player-controls').isVisible(),true);await p.screenshot({path:'visual-proof/04-desktop-sections.png',fullPage:false});await p.locator('.audio-section-toggle').click();await dc.close();
const mc=await browser.newContext({viewport:{width:412,height:915}});const mp=await mc.newPage();await seed(mp,src.id,true);await mp.locator('.audio-subtitle-float').waitFor({state:'visible',timeout:10000});const md=mp.locator('.audio-player-dock'), mb=await md.boundingBox(), ms=await mp.locator('.audio-subtitle-float').boundingBox();assert.ok(mb&&ms);assert.ok(ms.y+ms.height<=mb.y+2);await mp.screenshot({path:'visual-proof/05-mobile-subtitles.png',fullPage:false});await mp.locator('.audio-section-toggle').click();await mp.waitForTimeout(100);const ma=await md.boundingBox(), mPanel=await mp.locator('.audio-section-panel-floating').boundingBox();assert.ok(ma&&mPanel);console.log('mobile section geometry',JSON.stringify({before:mb,after:ma,panel:mPanel}));assert.ok(same(ma.width,mb.width)&&same(ma.height,mb.height));assert.ok(mPanel.y+mPanel.height<=ma.y+2);assert.equal(await mp.locator('.audio-player-timeline').isVisible(),true);assert.equal(await mp.locator('.audio-player-controls').isVisible(),true);await mp.screenshot({path:'visual-proof/06-mobile-sections.png',fullPage:false});await mc.close();await browser.close();
