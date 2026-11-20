import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function create(page: Page, title: string, type: string, choices: string[] = []) {
  await page.goto('/studio/polls/new')
  await page.getByLabel('Question',{exact:true}).fill(title)
  await page.getByLabel('Question type').selectOption(type)
  for (const [i,label] of choices.entries()) {
    if (i>=2) await page.getByRole('button',{name:'Add choice'}).click()
    await page.getByLabel('Choice '+(i+1),{exact:true}).fill(label)
  }
  if (type==='rating') await page.getByLabel('Highest rating').fill('10')
  await page.getByRole('button',{name:'Save draft'}).click()
  await page.getByRole('button',{name:'Publish poll'}).click()
  const link=page.getByRole('textbox',{name:'Share link'})
  await expect(link).toBeVisible()
  return link.inputValue()
}
test('advanced types preserve one ballot and update live with type-specific results', async ({page,browser})=>{
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Poll types tester')
  await page.getByLabel('Email').fill('types-'+crypto.randomUUID()+'@example.com')
  await page.getByLabel('Password').fill('poll types fixture password')
  await page.getByRole('button',{name:'Create account'}).click()
  await expect(page.getByRole('heading',{name:'Welcome, Poll.'})).toBeVisible()
  const context=await browser.newContext({viewport:{width:390,height:850},isMobile:true,hasTouch:true})
  try {
    const guest=await context.newPage()
    let url=await create(page,'Which topics interest you?','multiple_choice',['Design','Coding','Research'])
    await guest.goto(url)
    await guest.getByRole('checkbox',{name:'Design'}).check()
    await guest.getByRole('checkbox',{name:'Coding'}).check()
    await expect(guest.getByRole('checkbox',{name:'Research'})).toBeDisabled()
    await guest.getByRole('button',{name:'Cast vote'}).click()
    await expect(page.getByText('1 ballot',{exact:true})).toBeVisible()
    await expect(page.getByText(/2 selections/)).toBeVisible()

    url=await create(page,'Rate the workshop','rating')
    await guest.goto(url)
    await guest.getByRole('radio',{name:'10',exact:true}).check()
    await guest.getByRole('button',{name:'Cast vote'}).click()
    await expect(page.getByText('Average 10.00 out of 10')).toBeVisible()

    url=await create(page,'Rank the topics','ranked_choice',['Design','Coding','Research'])
    await guest.goto(url)
    await guest.getByRole('button',{name:'Move Coding up'}).click()
    await guest.getByRole('button',{name:'Cast vote'}).click()
    await expect(page.getByText('Borda lead · Coding')).toBeVisible()

    url=await create(page,'Describe the workshop','word_cloud')
    await guest.goto(url)
    await guest.getByLabel('Your word or short phrase').fill('  Team   Work  ')
    await guest.getByRole('button',{name:'Cast vote'}).click()
    await expect(guest.getByText(/Response received/)).toBeVisible()
    await expect(guest.getByText('0 approved responses')).toBeVisible()
    await expect(guest.locator('.word-cloud')).toHaveCount(0)
    await page.getByRole('button',{name:'Approve team work'}).click()
    await expect(guest.getByText('1 approved response')).toBeVisible()
    await expect(guest.locator('.word-cloud')).toContainText('team work')
  } finally { await context.close() }
})
