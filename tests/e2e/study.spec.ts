import { expect, test, type APIRequestContext } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { readAllPages } from '../../lib/async'
import { readPackage } from '../../lib/import/package'
import { fixturePackage } from '../../lib/import/test-package'
import { uploadBank } from '../../lib/import/upload'

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('E2E requires a disposable local backend')
const convex = new ConvexHttpClient(url)
const key = `browser-test-${Date.now()}`
const cardId = `${key}:1`
let file: Buffer, imageId: string
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
    ).result
}
async function resolveFixtureReport(cardId: string) {
    let cursor: string | null = null
    do {
        const result: FunctionReturnType<typeof api.reports.list> = await convex.query(api.reports.list, { paginationOpts: { cursor, numItems: 20 } })
        const report = result.page.find((r) => r.cardId === cardId)
        if (report) {
            await convex.mutation(api.reports.resolve, { id: report._id })
            return
        }
        if (result.isDone) return
        cursor = result.continueCursor
    } while (cursor)
}
test.beforeAll(async () => {
    const fixture = await fixturePackage(),
        plan = await readPackage(fixture.file, fixture.SQL)
    file = Buffer.from(await fixture.file.arrayBuffer())
    imageId = plan.images[0].hash
    // A unique fixture bank only: existing questions, approvals and schedules are untouched.
    await uploadBank({ client: convex, file: fixture.file, plan, key, name: key, signal: new AbortController().signal, onProgress: () => {} })
})
test.afterAll(async () => {
    await convex.mutation(api.approvals.setApproval, { cardId, approved: false })
})

test('browser worker previews and imports an APKG with stable IDs', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await page.getByRole('button', { name: 'Import bank' }).click()
    await page.locator('input[type=file]').setInputFiles({ name: 'fixture.apkg', mimeType: 'application/octet-stream', buffer: file })
    await expect(page.getByText('1 questions · 1 images', { exact: false })).toBeVisible()
    await page.getByLabel('Import into').selectOption('new')
    await page.getByLabel('Bank name').fill(`${key}-upload`)
    await page.getByRole('button', { name: 'Import questions', exact: true }).click()
    await expect(page.getByText('1 questions are ready to study.')).toBeVisible()
    await page.locator('input[type=file]').setInputFiles({ name: 'fixture.apkg', mimeType: 'application/octet-stream', buffer: file })
    await expect(page.getByText('1 questions · 1 images', { exact: false })).toBeVisible()
    await page.getByLabel('Import into').selectOption(`${key}-upload`)
    await page.getByRole('button', { name: 'Import questions', exact: true }).click()
    await expect(page.getByText('This bank is already up to date.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    expect(errors).toEqual([])
    // Import updates matching content, preserving the fixture's Anki ID.
    const bank = (await convex.query(api.library.collections)).find((c) => c.key === `${key}-upload`)!
    const cards = await convex.query(api.library.page, { importId: bank.activeImportId!, paginationOpts: { numItems: 100, cursor: null } })
    expect(cards.page.map((c) => c.id)).toEqual([`${key}-upload:1`])
})

test('mobile practice stays focused, shows images and four reachable rating choices', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Import bank' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Search questions' }).fill('What is two plus two?')
    await page
        .getByRole('button', { name: /^Study: What is two plus two\?/ })
        .first()
        .click()
    const study = page.getByTestId('study-card')
    await expect(page.getByRole('banner')).toBeHidden()
    await expect(page.getByRole('region', { name: 'Question library' })).toBeHidden()
    await expect(study.getByRole('region', { name: 'Answer', exact: true })).toHaveCount(0)
    await expect(study.locator('img')).toHaveCount(0)
    await expect(study.getByRole('button', { name: /review in/ })).toHaveCount(0)
    await study.getByRole('button', { name: 'Reveal answer' }).click()
    await expect(study.getByRole('region', { name: 'Answer', exact: true })).toBeFocused()
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
        const image = await study.getByRole('img').boundingBox(),
            actions = await page.getByTestId('study-actions').boundingBox()
        expect(image!.y + image!.height).toBeLessThanOrEqual(actions!.y)
        expect(actions!.y + actions!.height).toBeLessThanOrEqual(height)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        for (const rating of ['Again', 'Hard', 'Good', 'Easy']) {
            const box = await study.getByRole('button', { name: new RegExp(`^${rating}, review`) }).boundingBox()
            expect(box!.height).toBeGreaterThanOrEqual(44)
            expect(box!.width).toBeGreaterThanOrEqual(44)
        }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/ratings-mobile.png', fullPage: true })
    await study.getByRole('button', { name: 'Enlarge Answer image 1' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await study.getByRole('button', { name: 'Back to library' }).click()
    await expect(page.getByRole('textbox', { name: 'Search questions' })).toHaveValue('What is two plus two?')
})

test('rating persists a due timestamp and blocks premature website and MCP access', async ({ page, request }) => {
    await page.goto('/')
    // Select only this run's bank rather than any previous fixture.
    await page.getByRole('navigation', { name: 'Study topics' }).getByRole('button', { name: key, exact: true }).click()
    await page.getByRole('button', { name: 'Study a random question' }).click()
    await page.getByRole('button', { name: 'Reveal answer' }).click()
    await page.getByRole('button', { name: 'Good, review in 10 min' }).click()
    await expect(page.getByText('You are caught up.', { exact: false })).toBeVisible()
    const state = (await convex.query(api.reviews.page, { paginationOpts: { numItems: 500, cursor: null } })).page.find((r) => r.cardId === cardId)!
    expect(state.approved).toBe(true)
    expect(state.dueAt! - state.updatedAt).toBe(600000)
    const direct = await request.get(`/api/questions/${cardId}`)
    expect(direct.status()).toBe(409)
    const random = await request.post('/api/questions/random', { data: { collection: key } })
    expect((await random.json()).code).toBe('NOT_DUE')
    const approvedIds = (await readAllPages((cursor) => convex.query(api.reviews.page, { paginationOpts: { cursor, numItems: 500 } })))
        .filter((r) => r.approved)
        .map((r) => r.cardId)
    const result = await mcp(request, 'get_random_questions', { count: 1, excludeCardIds: approvedIds.filter((id) => id !== cardId) })
    expect(result.isError).toBe(true)
    await page.reload()
    await page.getByRole('navigation', { name: 'Study topics' }).getByRole('button', { name: key, exact: true }).click()
    await expect(page.getByRole('button', { name: /^Study: What is two plus two\?/ })).toBeDisabled()
})

test('library summaries hide answers; API validates image and scope requests', async ({ request }) => {
    const first = await (await request.get('/api/questions')).json()
    expect(first.questions.length).toBeGreaterThan(0)
    expect(first.questions[0]).not.toHaveProperty('answer')
    expect((await request.get('/api/questions?page=-1')).status()).toBe(400)
    expect((await request.get('/api/images/not-a-hash')).status()).toBe(404)
    const image = await request.get(`/api/images/${imageId}`)
    expect(image.ok()).toBe(true)
    expect(image.headers()['content-type']).toBe('image/png')
    const noPrefix = await request.post('/api/questions/random', { data: { collection: key, category: ['Top'] } })
    expect(noPrefix.status()).toBe(404)
})

test('failed draws offer visible retry and initial connection is not an outage', async ({ page }) => {
    await page.routeWebSocket('ws://127.0.0.1:3210/**', (socket) => {
        const server = socket.connectToServer()
        server.onMessage((message) => setTimeout(() => socket.send(message), 500))
    })
    await page.goto('/')
    await expect(page.getByRole('banner').getByText('Connecting your practice set')).toBeVisible()
    await expect(page.getByText('Your shared learning library')).toBeVisible()
    await page.route('**/api/questions/random', (route) => route.fulfill({ status: 503, contentType: 'text/html', body: '<html>Proxy error</html>' }), {
        times: 1
    })
    await page.getByRole('button', { name: 'Study a random question' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load this question.' })).toBeFocused()
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByTestId('study-card')).toBeVisible()
})

test('a committed review with a lost confirmation recovers even if the next rating differs', async ({ page }) => {
    test.setTimeout(40000)
    const fixture = await fixturePackage(),
        plan = await readPackage(fixture.file, fixture.SQL),
        retryKey = `${key}-retry`
    await uploadBank({ client: convex, file: fixture.file, plan, key: retryKey, name: retryKey, signal: new AbortController().signal, onProgress: () => {} })
    let dropNextMutation = true
    await page.routeWebSocket('ws://127.0.0.1:3210/**', (socket) => {
        const server = socket.connectToServer()
        server.onMessage((message) => {
            const body = JSON.parse(message.toString())
            if (dropNextMutation && body.type === 'MutationResponse') {
                dropNextMutation = false
                return
            }
            socket.send(message)
        })
    })
    try {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/')
        await page.getByRole('button', { name: 'Topics', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: retryKey, exact: true }).click()
        await page.getByRole('button', { name: 'Study a random question' }).click()
        await page.getByRole('button', { name: 'Reveal answer' }).click()
        await page.getByRole('button', { name: 'Good, review in 10 min' }).click()
        await expect(page.getByRole('alert').filter({ hasText: 'could not be confirmed' })).toBeVisible({ timeout: 16000 })
        await page.getByRole('button', { name: 'Hard, review in 6 min' }).click()
        await expect(page.getByText('You are caught up.', { exact: false })).toBeVisible()
        const row = (await convex.query(api.reviews.page, { paginationOpts: { numItems: 500, cursor: null } })).page.find((r) => r.cardId === `${retryKey}:1`)!
        expect(row.rating).toBe('good')
        expect(row.dueAt! - row.updatedAt).toBe(600000)
    } finally {
        await convex.mutation(api.approvals.setApproval, { cardId: `${retryKey}:1`, approved: false })
    }
})

test('a review keeps mobile focus during the next draw and the waiting message becomes ready', async ({ page }) => {
    const fixture = await fixturePackage(),
        plan = await readPackage(fixture.file, fixture.SQL),
        waitKey = `${key}-wait`
    await uploadBank({ client: convex, file: fixture.file, plan, key: waitKey, name: waitKey, signal: new AbortController().signal, onProgress: () => {} })
    try {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/')
        await page.getByRole('button', { name: 'Topics', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: waitKey, exact: true }).click()
        await page.getByRole('button', { name: 'Study a random question' }).click()
        await page.getByRole('button', { name: 'Reveal answer' }).click()
        let release!: () => void
        const held = new Promise<void>((resolve) => {
            release = resolve
        })
        await page.route(
            '**/api/questions/random',
            async (route) => {
                await held
                await route.fulfill({
                    status: 409,
                    json: { code: 'NOT_DUE', error: 'You are caught up. These questions are resting until their next review.', nextDueAt: Date.now() + 2000 }
                })
            },
            { times: 1 }
        )
        const request = page.waitForRequest('**/api/questions/random')
        await page.getByRole('button', { name: 'Again, review in 1 min' }).click()
        await request
        await expect(page.getByRole('banner')).toBeHidden()
        await expect(page.getByTestId('study-card')).toBeVisible()
        release()
        await expect(page.getByText('You are caught up.', { exact: false })).toBeVisible()
        await expect(page.getByText('A question is ready to review.', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Continue practice', exact: true })).toBeEnabled()
    } finally {
        await convex.mutation(api.approvals.setApproval, { cardId: `${waitKey}:1`, approved: false })
    }
})

test('MCP sessions persist and share ratings with the mobile history', async ({ page, request }) => {
    const fixture = await fixturePackage(),
        plan = await readPackage(fixture.file, fixture.SQL),
        sessionKey = `${key}-sessions`
    plan.cards.push({
        ...plan.cards[0],
        source: { ...plan.cards[0].source, cardId: '2', noteId: '3', noteGuid: 'second-session-note' },
        question: { text: 'What is three plus three?', imageIds: [] }
    })
    const ids = [`${sessionKey}:1`, `${sessionKey}:2`]
    await uploadBank({
        client: convex,
        file: fixture.file,
        plan,
        key: sessionKey,
        name: sessionKey,
        signal: new AbortController().signal,
        onProgress: () => {}
    })
    try {
        for (const id of ids) await convex.mutation(api.approvals.setApproval, { cardId: id, approved: true })
        const invalid = await mcp(request, 'rate_question', { sessionId: 'not-a-session', cardId: ids[0], rating: 'good' })
        expect(invalid.isError).toBe(true)
        expect(invalid.content[0].text).toContain('Request a fresh batch')
        const approved = (await readAllPages((cursor) => convex.query(api.reviews.page, { paginationOpts: { cursor, numItems: 500 } })))
            .filter((r) => r.approved)
            .map((r) => r.cardId)
        const draw = await mcp(request, 'get_random_questions', { count: 2, excludeCardIds: approved.filter((id) => !ids.includes(id)) })
        expect(draw.isError).not.toBe(true)
        const batch = JSON.parse(draw.content[0].text)
        expect(batch.cards.map((c: { id: string }) => c.id).sort()).toEqual(ids)
        expect(batch.sessionId).toBeTruthy()
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/')
        await page.getByRole('button', { name: 'Agent sessions', exact: true }).click()
        await page
            .getByRole('button', { name: /2 questions · 0 rated/ })
            .first()
            .click()
        await page.getByRole('button', { name: /What is two plus two/ }).click()
        await expect(page.getByRole('banner')).toBeHidden()
        await expect(page.getByRole('region', { name: 'Answer', exact: true })).toHaveCount(0)
        await page.getByRole('button', { name: 'Reveal answer' }).click()
        await expect
            .poll(() =>
                page
                    .getByTestId('study-card')
                    .locator('img')
                    .evaluate((img) => (img as HTMLImageElement).naturalWidth)
            )
            .toBeGreaterThan(0)
        await page.getByRole('button', { name: 'Something’s off' }).click()
        await page.getByLabel('Note (optional)').fill('Reported from session history')
        await page.getByRole('button', { name: 'Save report', exact: true }).click()
        await expect(page.getByText('Report saved.', { exact: false })).toBeVisible()
        await page.getByRole('button', { name: 'Keep studying' }).click()
        const rated = JSON.parse((await mcp(request, 'rate_question', { sessionId: batch.sessionId, cardId: ids[0], rating: 'hard' })).content[0].text)
        expect(rated.rating).toBe('hard')
        await expect(page.getByText(/Rated Hard · Scheduled/)).toBeVisible()
        await expect(page.getByRole('button', { name: 'Good, review in 10 min' })).toBeDisabled()
        const replay = JSON.parse((await mcp(request, 'rate_question', { sessionId: batch.sessionId, cardId: ids[0], rating: 'easy' })).content[0].text)
        expect(replay).toEqual({ ...rated, alreadyReviewed: true })
        await page.getByRole('button', { name: 'Back to session' }).click()
        await page.getByRole('button', { name: /What is three plus three/ }).click()
        await page.getByRole('button', { name: 'Reveal answer' }).click()
        await page.getByRole('button', { name: 'Good, review in 10 min' }).click()
        await expect(page.getByRole('button', { name: /What is three plus three.*Rated Good/ })).toBeVisible()
        await page.getByRole('button', { name: 'All sessions' }).click()
        await expect(page.getByRole('button', { name: /2 questions · 2 rated/ }).first()).toBeVisible()
        await page.reload()
        await page.getByRole('button', { name: 'Agent sessions', exact: true }).click()
        await page
            .getByRole('button', { name: /2 questions · 2 rated/ })
            .first()
            .click()
        await expect(page.getByRole('button', { name: /What is three plus three.*Rated Good/ })).toBeVisible()
        await page.screenshot({ path: 'test-results/agent-session-mobile.png', fullPage: true })
        const state = await convex.query(api.sessions.get, { asOf: Date.now(), sessionId: batch.sessionId })
        expect(state!.entries.map((e) => e.rating).sort()).toEqual(['good', 'hard'])
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    } finally {
        for (const id of ids) {
            await convex.mutation(api.approvals.setApproval, { cardId: id, approved: false })
            await resolveFixtureReport(id)
        }
    }
})

test('mobile card reports persist, resolve, and leave study content and schedules untouched', async ({ page }) => {
    const fixture = await fixturePackage(),
        plan = await readPackage(fixture.file, fixture.SQL),
        reportKey = `${key}-reports`
    await uploadBank({ client: convex, file: fixture.file, plan, key: reportKey, name: reportKey, signal: new AbortController().signal, onProgress: () => {} })
    try {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/')
        await page.getByRole('button', { name: 'Topics', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: reportKey, exact: true }).click()
        await page.getByRole('button', { name: 'Study a random question' }).click()
        await expect(page.getByRole('button', { name: 'Something’s off' })).toHaveCount(0)
        await page.getByRole('button', { name: 'Reveal answer' }).click()
        await page.getByRole('button', { name: 'Something’s off' }).click()
        await page.getByLabel('What needs a look?').selectOption('image')
        await page.getByLabel('Note (optional)').fill(`Diagram needs a look ${reportKey}`)
        await page.getByRole('button', { name: 'Save report', exact: true }).click()
        await expect(page.getByText('Report saved.', { exact: false })).toBeVisible()
        await page.getByRole('button', { name: 'Keep studying' }).click()
        await page.getByRole('button', { name: 'Something’s off' }).click()
        await page.getByRole('button', { name: 'Save report', exact: true }).click()
        await expect(page.getByText('This question already has an open report.', { exact: false })).toBeVisible()
        await page.getByRole('button', { name: 'Keep studying' }).click()
        await expect(page.getByRole('region', { name: 'Answer', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Good, review in 10 min' })).toBeEnabled()
        await page.getByRole('button', { name: 'Back to library' }).click()
        await page.getByRole('button', { name: 'Card reports', exact: true }).click()
        const report = page.getByRole('listitem').filter({ hasText: `Diagram needs a look ${reportKey}` })
        await expect(report).toBeVisible()
        await page.reload()
        await page.getByRole('button', { name: 'Card reports', exact: true }).click()
        await expect(report).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
        await expect(page.getByRole('button', { name: 'Card reports', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await page.screenshot({ path: 'test-results/card-reports-mobile.png', fullPage: true, animations: 'disabled' })
        await report.getByRole('button', { name: 'Mark resolved' }).click()
        await expect(report).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Card reports', exact: true })).toBeFocused()
        const reviews = await convex.query(api.reviews.page, { paginationOpts: { numItems: 500, cursor: null } })
        expect(reviews.page.some((r) => r.cardId === `${reportKey}:1`)).toBe(false)
    } finally {
        await resolveFixtureReport(`${reportKey}:1`)
    }
})
