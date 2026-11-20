import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const app = process.env.BASE_URL ?? 'http://localhost:8080'
const screenshots = resolve(process.env.SCREENSHOT_DIR ?? '../docs/screenshots')
const recording = process.env.VIDEO_DIR
await mkdir(screenshots,{recursive:true})
if (recording) await mkdir(recording,{recursive:true})
const browser = await chromium.launch()
const viewport = {width:1440,height:1000}
const studio = await browser.newContext({viewport,reducedMotion:"reduce",recordVideo:recording ? {dir:recording,size:viewport} : undefined})
const guest = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:"reduce"})
const host = await studio.newPage()
const viewer = await guest.newPage()
const email = 'capture-'+crypto.randomUUID()+'@example.com'

async function screenshot(page,name) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({path:resolve(screenshots,name+'.png'),animations:'disabled',fullPage:true})
}
async function explain(page,text,seconds) {
  if (!recording) return
  await page.evaluate(text => {
    document.querySelector('#recording-caption')?.remove()
    const caption=document.createElement('div')
    caption.id='recording-caption'
    caption.textContent=text
    Object.assign(caption.style,{
      position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',zIndex:9999,
      width:'min(920px,90vw)',background:'#201a30',color:'#f5efff',padding:'18px 24px',
      borderRadius:'12px',border:'1px solid #9d82e6',fontSize:'22px',boxShadow:'0 12px 40px #0009',
    })
    document.body.append(caption)
  },text)
  await page.waitForTimeout(seconds*1000)
  await page.evaluate(() => document.querySelector('#recording-caption')?.remove())
}
async function seed(path, body, cookie) {
  const r = await fetch(app+'/api/v1'+path,{method:'POST',headers:{
    Origin:app,'Content-Type':'application/json',...(cookie ? {Cookie:cookie} : {}),
  },body:JSON.stringify(body)})
  if (!r.ok) throw Error(path+' returned HTTP '+r.status)
  return r.json()
}
try {
  await host.goto(app)
  await screenshot(host,'landing')
  await explain(host,'PULSEX · Live audience polling for classrooms, meetings, and workshops. This recording uses the running local Docker stack.',24)
  await host.goto(app+'/register')
  await host.getByLabel('Display name').fill('Alex Morgan')
  await host.getByLabel('Email').fill(email)
  await host.getByLabel('Password').fill('demo fixture password')
  await host.getByRole('button',{name:'Create account'}).click()
  await host.waitForURL('**/studio')
  await explain(host,'The creator account has its own workspace. The Go API stores an opaque session token hash, and the browser receives an HttpOnly cookie.',14)
  await host.goto(app+'/studio/polls/new')
  const question = 'What should our team explore next?'
  await host.getByLabel('Question',{exact:true}).fill(question)
  await host.getByLabel('Description',{exact:false}).fill('Pick the direction you would most like to explore in our next workshop.')
  await host.getByLabel('Choice 1',{exact:true}).fill('Build a prototype')
  await host.getByLabel('Choice 2',{exact:true}).fill('Interview customers')
  await host.getByRole('button',{name:'Add choice'}).click()
  await host.getByLabel('Choice 3',{exact:true}).fill('Map the opportunity')
  await screenshot(host,'editor')
  await explain(host,'The Studio preview shows the question as the audience will see it. Creators can schedule opening and closing, require sign-in, or hide results until voting ends.',20)
  await host.getByRole('button',{name:'Save draft'}).click()
  await host.getByRole('button',{name:'Publish poll'}).click()
  const link = await host.getByRole('textbox',{name:'Share link'}).inputValue()
  await host.getByText('0 votes',{exact:true}).waitFor()
  await explain(host,'Publish a draft to activate its link and QR code. The creator panel opens its own live stream and starts with an authoritative zero-vote snapshot.',18)
  await viewer.goto(link)
  await viewer.getByRole('heading',{name:question}).waitFor()
  await screenshot(viewer,'mobile-vote')
  await host.evaluate(() => {
    const text=document.createElement('div')
    text.id='recording-caption'
    text.textContent='Watch the total on this screen. A vote is being cast in a separate mobile browser session.'
    Object.assign(text.style,{position:'fixed',bottom:'24px',left:'20%',right:'20%',zIndex:9999,padding:'18px 24px',background:'#201a30',border:'1px solid #bca8ff',borderRadius:'12px',fontSize:'22px'})
    document.body.append(text)
  })
  if (recording) await host.waitForTimeout(7000)
  await viewer.getByRole('radio',{name:'Build a prototype'}).check()
  await viewer.getByRole('button',{name:'Cast vote'}).click()
  await host.getByText('1 vote',{exact:true}).waitFor()
  if (recording) await host.waitForTimeout(8000)
  await host.evaluate(() => document.querySelector('#recording-caption')?.remove())
  const pollApi = link.replace('/p/','/api/v1/public/polls/')
  for (const choice of [0,0,0,1,1,2]) {
    const response = await fetch(pollApi)
    const cookie = response.headers.get('set-cookie').split(';')[0]
    await seed(new URL(pollApi).pathname.replace('/api/v1','')+'/votes',{choice},cookie)
  }
  await host.getByText('7 votes',{exact:true}).waitFor()
  await host.waitForFunction(() => {
    const bar = document.querySelector('.fill')
    return bar?.parentElement && Math.abs(bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width - 0.57) < 0.015
  })
  await screenshot(host,'live-results')
  await explain(host,'The consistency challenge: a vote, its count, and a pending projection marker commit together in MongoDB. If the unique vote index rejects a duplicate, the count increment rolls back too.',21)
  await explain(host,'The worker writes complete snapshots into Redis. Lua accepts only a newer revision or an empty key. Redis publishes the update, and SSE pushes a fresh result to listeners without a page reload.',20)
  await host.getByRole('link',{name:'Analytics'}).click()
  await host.getByRole('heading',{name:'Votes by hour'}).waitFor()
  await screenshot(host,'analytics')
  await explain(host,'Insights use committed votes to calculate participation over time. A creator can download the actual choice totals as CSV. After Redis loss, the persisted MongoDB aggregate rebuilds the projection.',20)
  await host.goto(app+'/studio')
  await host.getByRole('heading',{name:'Welcome, Alex.'}).waitFor()
  await screenshot(host,'studio')
  await explain(host,'AI disclosure: Codex generated the initial code, tests, and documentation, then used real API and Chromium test results to revise the implementation. This walkthrough is scripted and uses synthetic demo accounts.',33)
} finally {
  await guest.close()
  await studio.close()
  if (recording) console.log('Recording:',await host.video()?.path())
  await browser.close()
}
