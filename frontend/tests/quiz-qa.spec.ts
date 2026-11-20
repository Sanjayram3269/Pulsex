import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

async function capture(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  await mkdir(dir,{recursive:true})
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({path:join(dir,name+'.png'),animations:'disabled',fullPage:true})
}

async function register(page: Page) {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Quiz host')
  await page.getByLabel('Email').fill('quiz-'+crypto.randomUUID()+'@example.com')
  await page.getByLabel('Password').fill('quiz flow fixture password')
  await page.getByRole('button',{name:'Create account'}).click()
  await expect(page.getByRole('heading',{name:'Welcome, Quiz.'})).toBeVisible()
}
test('quiz scoring, private reveals, timed answers, rankings and moderated Q&A',async({page,browser,baseURL})=>{
  test.setTimeout(90000)
  await register(page)
  await page.goto('/studio/quizzes/new')
  await page.getByLabel('Quiz title').fill('Workshop quiz')
  await page.getByLabel('Reveal answers').selectOption('final')
  await page.getByLabel('Presentation theme').selectOption('aurora')
  for (let n=1;n<=3;n++) {
    if(n>1) await page.getByRole('button',{name:'Add question',exact:true}).click()
    await page.getByLabel('Prompt '+n).fill('Which choice belongs to round '+n+'?')
    await page.getByLabel('Question '+n+' choice 1').fill('First option')
    await page.getByLabel('Question '+n+' choice 2').fill('Second option')
  }
  await page.getByRole('button',{name:'Save quiz'}).click()
  const link=page.getByRole('textbox',{name:'Share link'})
  await expect(link).toBeVisible()
  const url=await link.inputValue()
  const code=url.split('/').pop()!
  const apiPath='/api/v1/public/quizzes/'+code
  const hostID=page.url().split('/').pop()!
  const first=await browser.newContext({baseURL})
  const second=await browser.newContext({baseURL,viewport:{width:390,height:850}})
  try {
    const a=await first.newPage()
    const b=await second.newPage()
    const screen=await second.newPage()
    await a.goto(url)
    await b.goto(url)
    for (const [player,alias] of [[a,'Avery'],[b,'Blake']] as const) {
      await player.getByLabel('Display name').fill(alias)
      await player.getByRole('button',{name:'Join quiz'}).click()
      await expect(player.getByRole('button',{name:'Join quiz'})).toHaveCount(0)
    }
    await page.getByRole('button',{name:'Enable Q&A'}).click()
    await page.getByRole('button',{name:'Start quiz'}).click()
    const question='Will today’s materials be available?'
    await a.getByLabel('Your question').fill(question)
    await a.getByRole('button',{name:'Submit question'}).click()
    await expect(a.getByText('Question submitted for host review.')).toBeVisible()
    await expect(b.getByText(question)).toHaveCount(0)
    const unauthOwner=await b.request.get('/api/v1/rooms/'+hostID+'/qa')
    expect(unauthOwner.status()).toBe(401)
    await page.getByRole('button',{name:'Approve',exact:true}).click()
    await expect(b.getByText(question)).toBeVisible()
    await b.getByRole('button',{name:'Upvote question'}).click()
    await expect(b.getByRole('button',{name:'Remove upvote'})).toBeVisible()
    await expect(page.getByText('1 upvotes')).toBeVisible()
    await b.getByRole('button',{name:'Remove upvote'}).click()
    await expect(page.getByText('0 upvotes')).toBeVisible()
    await page.getByRole('button',{name:'Pin',exact:true}).click()
    await expect(page.getByRole('button',{name:'Unpin',exact:true})).toBeVisible()
    await screen.goto(url+'/present')
    await expect(screen.getByText(question,{exact:true})).toBeVisible()
    await expect(screen.locator('.theme-aurora')).toHaveCount(1)
    await capture(page,'v2-qa-host')

    for (let n=0;n<3;n++) {
      const prompt='Which choice belongs to round '+(n+1)+'?'
      await expect(a.getByRole('heading',{name:prompt})).toBeVisible()
      const before=await a.request.get(apiPath)
      const payload=await before.json()
      expect(payload.question.correct).toBeUndefined()
      expect(payload.leaderboard).toBeUndefined()
      await a.getByRole('radio',{name:'First option'}).check()
      await a.getByRole('button',{name:'Submit answer'}).click()
      await expect(a.getByText('Answer received.')).toBeVisible()
      const duplicate=await a.request.post(apiPath+'/answers',{data:{round:n,choice:1},headers:{Origin:baseURL!}})
      expect(duplicate.status()).toBe(409)
      if (n>0) {
        await b.getByRole('radio',{name:n===1?'First option':'Second option'}).check()
        await b.getByRole('button',{name:'Submit answer'}).click()
        await expect(b.getByText('Answer received.')).toBeVisible()
      }
      if (n===0) {
        await a.reload()
        await expect(a.getByText('Answer received.')).toBeVisible()
        const rejoin=await a.request.post(apiPath+'/join',{data:{name:'Avery'},headers:{Origin:baseURL!}})
        expect(await rejoin.json()).not.toHaveProperty('points')
      }
      if (n<2) {
        await page.getByRole('button',{name:'Close question'}).click()
        await expect(a.getByText('Answers will be revealed when the quiz ends.')).toBeVisible()
        const late=await b.request.post(apiPath+'/answers',{data:{round:n,choice:0},headers:{Origin:baseURL!}})
        expect(late.status()).toBe(409)
        await page.getByRole('button',{name:'Next question'}).click()
      }
    }
    await page.getByRole('button',{name:'Finish quiz'}).click()
    await expect(a.getByRole('heading',{name:'Final leaderboard'})).toBeVisible()
    await expect(a.getByText('300 pts · 3 correct')).toBeVisible()
    await expect(a.getByText('100 pts · 1 correct')).toBeVisible()
    await expect(a.getByRole('heading',{name:'Answer review'})).toBeVisible()
    await capture(a,'v2-quiz-leaderboard')
    await page.getByRole('link',{name:'Session insights'}).click()
    await expect(page.getByText('50%',{exact:true}).first()).toBeVisible()
    await capture(page,'v2-session-insights')
    const denied=await b.request.get('/api/v1/quizzes/'+hostID+'/export')
    expect(denied.status()).toBe(401)
  } finally {await first.close();await second.close()}
})

test('guided demo opens an isolated live room without signup',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/')
  const preview=page.getByRole('img',{name:/PULSEX session insights/})
  await expect(preview).toBeVisible()
  await preview.scrollIntoViewIfNeeded()
  await preview.evaluate(img=>(img as HTMLImageElement).decode())
  await capture(page,'v2-landing')
  await page.getByRole('link',{name:'Try the live demo'}).click()
  await page.getByRole('button',{name:'Start demo room'}).click()
  await expect(page.getByRole('heading',{name:'Which activities would you try?'})).toBeVisible()
  await page.getByRole('checkbox',{name:'Build a prototype'}).check()
  await page.getByRole('checkbox',{name:'Map customer needs'}).check()
  await page.getByRole('button',{name:'Cast vote'}).click()
  await expect(page.getByText('1 ballot',{exact:true})).toBeVisible()
  await expect(page.getByText(/2 selections/)).toBeVisible()
  await page.waitForFunction(()=>{
    const bar=document.querySelector('.fill')
    return bar?.parentElement && bar.getBoundingClientRect().width>=bar.parentElement.getBoundingClientRect().width-1
  })
  await capture(page,'v2-guided-demo')
})
