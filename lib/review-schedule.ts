export const reviewIntervals = {
    again: { label: 'Again', delay: 60_000, interval: '1 min' },
    hard: { label: 'Hard', delay: 6 * 60_000, interval: '6 min' },
    good: { label: 'Good', delay: 10 * 60_000, interval: '10 min' },
    easy: { label: 'Easy', delay: 10 * 24 * 60 * 60_000, interval: '10 days' }
} as const
export type ReviewRating = keyof typeof reviewIntervals
export type ReviewState = { cardId: string; approved: boolean; dueAt?: number; rating?: ReviewRating; updatedAt: number }
export function isDue(dueAt: number | undefined, now: number) {
    return dueAt === undefined || dueAt <= now
}
