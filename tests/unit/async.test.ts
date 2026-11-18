import { afterEach, expect, test, vi } from 'vitest'
import { readAllPages, withTimeout } from '../../lib/async'

afterEach(() => vi.useRealTimers())

test('timeouts clear their timer on success and failure', async () => {
    vi.useFakeTimers()
    expect(await withTimeout(Promise.resolve('saved'))).toBe('saved')
    expect(vi.getTimerCount()).toBe(0)
    await expect(withTimeout(Promise.reject(new Error('offline')))).rejects.toThrow('offline')
    expect(vi.getTimerCount()).toBe(0)
})

test('a timed-out mutation can still commit, so timeout is not cancellation', async () => {
    vi.useFakeTimers()
    let finish!: (value: string) => void
    const mutation = new Promise<string>((resolve) => {
        finish = resolve
    })
    const result = expect(withTimeout(mutation, 50)).rejects.toThrow('Request timed out')
    await vi.advanceTimersByTimeAsync(50)
    await result
    finish('committed')
    expect(await mutation).toBe('committed')
    expect(vi.getTimerCount()).toBe(0)
})

test('pagination follows cursors through empty intermediate pages', async () => {
    const read = vi.fn(async (cursor: string | null) => {
        if (cursor === null) return { page: [1], isDone: false, continueCursor: 'second' }
        if (cursor === 'second') return { page: [], isDone: false, continueCursor: 'third' }
        return { page: [2, 3], isDone: true, continueCursor: '' }
    })
    expect(await readAllPages(read)).toEqual([1, 2, 3])
    expect(read.mock.calls).toEqual([[null], ['second'], ['third']])
})

test('pagination rejects instead of returning a partial approval list', async () => {
    await expect(
        readAllPages(async (cursor) => {
            if (cursor === null) return { page: ['card:1'], isDone: false, continueCursor: 'next' }
            throw new Error('Unavailable')
        })
    ).rejects.toThrow('Unavailable')
})
