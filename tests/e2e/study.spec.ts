import { expect, test, type APIRequestContext } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'

// These tests mutate only an anonymous local development backend.
const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('E2E tests require a local Convex backend')
const convex = new ConvexHttpClient(url)
const cardId = 'sketchy-pharm:1476210878808'
const imageId = '5242187d47e06f71c02a393953ec9710f1b5b8038780d9a09b0537a46c9d4201'

const staleCardId = 'sketchy-pharm:1'
let ownsFixtures = false

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
    const response = await request.post('/api/mcp', {
        headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
    })
    expect(response.ok()).toBe(true)
    const text = await response.text()
    return JSON.parse(
        text
            .split('\n')
            .find((line) => line.startsWith('data: '))
            ?.slice(6) ?? text
    ).result as {
        isError?: boolean
        content: Array<{ type: string; text: string }>
    }
}

test.beforeAll(async () => {
    if ((await convex.query(api.approvals.list)).length)
        throw new Error('E2E tests require an empty, disposable local Convex backend; existing approvals were left untouched.')
    ownsFixtures = true
})
test.afterAll(async () => {
    if (ownsFixtures) for (const id of [cardId, staleCardId]) await convex.mutation(api.approvals.setApproval, { cardId: id, approved: false })
})

test('study, reveal, approve, reload, and revoke change the actual MCP pool', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    expect((await mcp(request, 'get_random_questions', { count: 1 })).isError).toBe(true)
    expect((await mcp(request, 'get_anki_image', { imageId })).isError).toBe(true)
    await page.goto('/')
    await expect(page.getByText('Your shared learning library')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Study:/ }).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true, animations: 'disabled' })
    await page.getByRole('textbox', { name: 'Search questions' }).fill('What acid/base disorder does Acetazolamide cause?')
    await page.getByRole('button', { name: 'Study: What acid/base disorder does Acetazolamide cause?' }).click()
    const study = page.getByTestId('study-card')
    await expect(study.getByRole('heading', { name: 'What acid/base disorder does Acetazolamide cause?' })).toBeVisible()
    await expect(study.getByRole('heading', { name: 'What acid/base disorder does Acetazolamide cause?' })).toBeFocused()
    await expect(study.getByRole('region', { name: 'Answer', exact: true })).toHaveCount(0)
    await expect(study.getByRole('button', { name: 'Add to practice' })).toHaveCount(0)
    await expect(study.locator('img')).toHaveCount(0)
    await study.getByRole('button', { name: 'Reveal answer' }).click()
    await expect(study.getByRole('region', { name: 'Answer', exact: true })).toBeFocused()
    await expect(study.getByText('Normal anion gap metabolic acidosis', { exact: false })).toBeVisible()
    await expect(study.getByRole('img')).toHaveCount(1)
    await expect.poll(() => study.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await study.getByRole('button', { name: 'Enlarge Answer image 1' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await study.getByRole('button', { name: 'Add to practice' }).click()
    await expect(study.getByRole('button', { name: 'Remove from agent practice' })).toBeVisible()
    const approved = await (await request.get('/api/questions?status=approved')).json()
    expect(approved.questions.map((card: { id: string }) => card.id)).toEqual([cardId])
    expect((await (await request.get('/api/questions?status=new')).json()).total).toBe(1317)
    expect((await (await request.post('/api/questions/random', { data: { status: 'approved' } })).json()).card.id).toBe(cardId)
    await convex.mutation(api.approvals.setApproval, { cardId: staleCardId, approved: true })
    await expect(page.getByTestId('practice-count')).toHaveText('1')
    const result = await mcp(request, 'get_random_questions', { count: 1 })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text).cards.map((card: { id: string }) => card.id)).toEqual([cardId])
    expect((await mcp(request, 'get_anki_image', { imageId })).isError).toBeUndefined()
    await page.screenshot({ path: 'test-results/study-desktop.png', fullPage: true, animations: 'disabled' })
    await page.reload()
    await page.getByRole('button', { name: 'In practice', exact: true }).click()
    await page.getByRole('button', { name: 'Study: What acid/base disorder does Acetazolamide cause?' }).click()
    await expect(study.getByRole('region', { name: 'Answer', exact: true })).toHaveCount(0)
    await study.getByRole('button', { name: 'Reveal answer' }).click()
    await study.getByRole('button', { name: 'Remove from agent practice' }).click()
    await expect(study.getByRole('button', { name: 'Add to practice' })).toBeVisible()
    expect((await mcp(request, 'get_random_questions', { count: 1 })).isError).toBe(true)
    expect((await mcp(request, 'get_anki_image', { imageId })).isError).toBe(true)
    await convex.mutation(api.approvals.setApproval, { cardId: staleCardId, approved: false })
    expect(errors).toEqual([])
})

test('category scopes include descendants and random rounds do not repeat', async ({ page, request }) => {
    await page.goto('/')
    const topics = page.getByRole('navigation', { name: 'Study topics' })
    await topics.getByRole('button', { name: /^Cardiovascular & Renal/ }).click()
    await expect(page.getByRole('region', { name: 'Question library' }).getByRole('heading', { name: 'Cardiovascular & Renal' })).toBeVisible()
    await topics.getByRole('button', { name: 'Expand Cardiovascular & Renal' }).click()
    await topics.getByRole('button', { name: /^Diuretics\s/ }).click()
    await topics.getByRole('button', { name: 'Expand Diuretics' }).click()
    await topics.getByRole('button', { name: /^Acetazolamide, mannitol/ }).click()
    await page.getByRole('button', { name: 'Study a random question' }).click()
    await expect(page.getByTestId('study-card')).toContainText('Cardiovascular & Renal / Diuretics / Acetazolamide, mannitol')
    const excludeCardIds: string[] = []
    for (let i = 0; i < 4; i++) {
        const response = await request.post('/api/questions/random', {
            data: { collection: 'sketchy-pharm', category: ['Putting It Together'], excludeCardIds }
        })
        expect(response.ok()).toBe(true)
        const { card } = await response.json()
        expect(card.categories).toEqual(['Putting It Together'])
        expect(excludeCardIds).not.toContain(card.id)
        excludeCardIds.push(card.id)
    }
    const exhausted = await request.post('/api/questions/random', { data: { collection: 'sketchy-pharm', category: ['Putting It Together'], excludeCardIds } })
    expect(exhausted.status()).toBe(409)
    expect((await exhausted.json()).code).toBe('ROUND_COMPLETE')
    await topics.getByRole('button', { name: /^Putting It Together/ }).click()
    await page.getByRole('button', { name: 'Study a random question' }).click()
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Skip for now' }).click()
    await expect(page.getByRole('button', { name: 'Start another round' })).toBeVisible()
    await page.getByRole('button', { name: 'Start another round' }).click()
    await expect(page.getByRole('button', { name: 'Reveal answer' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start another round' })).toHaveCount(0)
    await topics.getByRole('button', { name: /^All questions/ }).click()
    await expect(page.getByRole('region', { name: 'Question library' }).getByRole('heading', { name: 'All questions' })).toBeVisible()
})

test('mobile topics, study, and image display fit a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Study a random question' })).toBeEnabled()
    await page.getByRole('button', { name: 'Topics', exact: true }).click()
    await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Putting It Together/ })
        .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Study a random question' }).click()
    await page.getByRole('button', { name: 'Reveal answer' }).click()
    await expect(page.getByTestId('study-card').getByRole('img').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/study-mobile.png', fullPage: true, animations: 'disabled' })
})

test('library APIs paginate, hide answers, and reject invalid image requests', async ({ request }) => {
    const first = await (await request.get('/api/questions')).json()
    expect(first.questions).toHaveLength(24)
    expect(first.total).toBe(1318)
    expect(first.questions[0]).not.toHaveProperty('answer')
    const second = await (await request.get('/api/questions?page=2')).json()
    expect(second.questions[0].id).not.toBe(first.questions[0].id)
    expect((await request.get('/api/questions?page=-1')).status()).toBe(400)
    expect((await request.get('/api/images/not-a-hash')).status()).toBe(404)
    expect((await request.get(`/api/images/${'0'.repeat(64)}`)).status()).toBe(404)
    const image = await request.get(`/api/images/${imageId}`)
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toBe('image/jpeg')
    expect(image.headers()['cache-control']).toContain('immutable')
})

test('failed study requests offer retry without approving a question', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Study a random question' })).toBeEnabled()
    await page.route('**/api/questions/random', (route) => route.fulfill({ status: 503, contentType: 'text/html', body: '<html>Proxy error</html>' }), {
        times: 1
    })
    await page.getByRole('button', { name: 'Study a random question' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load this question. Please try again.' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByTestId('study-card')).toBeVisible()
    expect(await convex.query(api.approvals.list)).toEqual([])
})

test('initial connection shows progress without an outage warning', async ({ page }) => {
    await page.routeWebSocket('ws://127.0.0.1:3210/**', (socket) => {
        const server = socket.connectToServer()
        server.onMessage((message) => setTimeout(() => socket.send(message), 1500))
    })
    await page.goto('/')
    await expect(page.getByRole('banner').getByText('Connecting your practice set')).toBeVisible()
    await expect(page.getByText('Saving to agent practice is temporarily unavailable.', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Your shared learning library')).toBeVisible()
})

test('search preserves the revealed card, and mobile topics reopen at the selected branch', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Topics', exact: true }).click()
    let topics = page.getByRole('dialog')
    await topics.getByRole('button', { name: 'Expand Cardiovascular & Renal' }).click()
    await topics.getByRole('button', { name: 'Expand Diuretics' }).click()
    await topics.getByRole('button', { name: /^Acetazolamide, mannitol/ }).click()
    await page.getByRole('button', { name: 'Study a random question' }).click()
    const study = page.getByTestId('study-card')
    const question = await study.getByRole('heading').textContent()
    await study.getByRole('button', { name: 'Reveal answer' }).click()
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.getByRole('textbox', { name: 'Search questions' }).fill('nothing matches this search')
    await expect(study.getByRole('heading')).toHaveText(question!)
    await expect(study.getByRole('region', { name: 'Answer', exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.getByRole('button', { name: 'Topics', exact: true }).click()
    topics = page.getByRole('dialog')
    await expect(topics.getByRole('button', { name: /^Acetazolamide, mannitol/ })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 1100 })
    const desktopTopics = page.getByRole('complementary').getByRole('navigation', { name: 'Study topics' })
    await expect(desktopTopics.getByRole('button', { name: /^Acetazolamide, mannitol/ })).toHaveAttribute('aria-pressed', 'true')
    await desktopTopics.getByRole('button', { name: 'Collapse Cardiovascular & Renal' }).click()
    await expect(desktopTopics.getByRole('button', { name: /^Acetazolamide, mannitol/ })).toHaveCount(0)
})

test('closing a card cancels a pending random draw and leaves the library usable', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Study a random question' }).click()
    await expect(page.getByTestId('study-card')).toBeVisible()
    let releaseResponse!: () => void
    let finishRoute!: () => void
    const held = new Promise<void>((resolve) => {
        releaseResponse = resolve
    })
    const finished = new Promise<void>((resolve) => {
        finishRoute = resolve
    })
    await page.route(
        '**/api/questions/random',
        async (route) => {
            const response = await route.fetch()
            await held
            try {
                await route.fulfill({ response })
            } finally {
                finishRoute()
            }
        },
        { times: 1 }
    )
    const pending = page.waitForRequest('**/api/questions/random')
    await page.getByRole('button', { name: 'Skip for now' }).click()
    const request = await pending
    const cancelled = page.waitForEvent('requestfailed', (failed) => failed === request)
    await page.getByRole('button', { name: 'Back to library' }).click()
    await cancelled
    await expect(page.getByTestId('study-card')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Study a random question' })).toBeEnabled()
    releaseResponse()
    await finished
    await expect(page.getByTestId('study-card')).toHaveCount(0)
    await page
        .getByRole('button', { name: /^Study:/ })
        .first()
        .click()
    await expect(page.getByTestId('study-card')).toBeVisible()
})

test('mobile practice stays focused with reachable actions and no obscured images', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/')
    await page.getByRole('textbox', { name: 'Search questions' }).fill('What acid/base disorder does Acetazolamide cause?')
    await page.getByRole('button', { name: 'Study: What acid/base disorder does Acetazolamide cause?' }).click()
    const study = page.getByTestId('study-card')
    await expect(page.getByRole('banner')).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Make it familiar.' })).toBeHidden()
    await expect(page.getByRole('region', { name: 'Question library' })).toBeHidden()
    await expect(page.getByText('Questions to explore', { exact: true })).toBeHidden()
    for (const name of ['Reveal answer', 'Skip for now', 'Back to library']) {
        const bounds = await page.getByRole('button', { name, exact: true }).boundingBox()
        expect(bounds!.height).toBeGreaterThanOrEqual(44)
        expect(bounds!.width).toBeGreaterThanOrEqual(44)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640)
    }
    await expect(study.getByRole('region', { name: 'Answer', exact: true })).toHaveCount(0)
    await study.getByRole('button', { name: 'Reveal answer' }).click()
    await expect(study.getByRole('img')).toHaveCount(1)
    await expect.poll(() => study.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    for (const [width, height] of [
        [320, 640],
        [390, 640],
        [430, 640],
        [768, 640],
        [844, 390]
    ]) {
        await page.setViewportSize({ width, height })
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const image = await study.getByRole('img').boundingBox()
        const actions = await page.getByTestId('study-actions').boundingBox()
        expect(image!.y + image!.height).toBeLessThanOrEqual(actions!.y)
        expect(actions!.y + actions!.height).toBeLessThanOrEqual(height)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await study.getByRole('button', { name: 'Add to practice', exact: true }).click()
    await expect(study.getByRole('button', { name: 'Remove from agent practice', exact: true })).toBeVisible()
    await study.getByRole('button', { name: 'Remove from agent practice', exact: true }).click()
    await expect(study.getByRole('button', { name: 'Add to practice', exact: true })).toBeVisible()
    await page.route('**/api/questions/random', (route) => route.fulfill({ status: 503, json: { error: 'Please retry this draw.' } }), { times: 1 })
    await study.getByRole('button', { name: 'Next question' }).click()
    const feedback = page.getByRole('alert').filter({ hasText: 'Please retry this draw.' })
    await expect(feedback).toBeFocused()
    const feedbackBounds = await feedback.boundingBox()
    const barBounds = await page.getByTestId('study-actions').boundingBox()
    expect(feedbackBounds!.y).toBeGreaterThanOrEqual(0)
    expect(feedbackBounds!.y + feedbackBounds!.height).toBeLessThanOrEqual(barBounds!.y)
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    const restart = page.getByRole('button', { name: 'Start another round' })
    await expect(restart).toBeVisible()
    const restartBounds = await restart.boundingBox()
    expect(restartBounds!.y + restartBounds!.height).toBeLessThanOrEqual((await page.getByTestId('study-actions').boundingBox())!.y)
    await restart.click()
    await expect(study.getByRole('button', { name: 'Reveal answer' })).toBeVisible()
    await study.getByRole('button', { name: 'Back to library' }).click()
    await expect(page.getByRole('region', { name: 'Question library' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search questions' })).toHaveValue('What acid/base disorder does Acetazolamide cause?')
})
