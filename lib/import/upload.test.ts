import { expect, test } from 'bun:test'
import type { BankCard } from '../bank-types'
import { bankKey, cardBatches } from './upload'
test('non-Latin names have stable nonempty keys without changing existing ASCII keys', () => {
    expect(bankKey('Sketchy Pharm')).toBe('sketchy-pharm')
    expect(bankKey('薬理学')).toMatch(/^bank-[a-f0-9]{16}$/)
    expect(bankKey('薬理学')).toBe(bankKey('薬理学'))
    expect(bankKey('薬理学')).not.toBe(bankKey('薬理学二'))
    expect(bankKey('  ')).toBe('')
})
test('large valid cards are split by encoded bytes rather than only card count', async () => {
    const cards: BankCard[] = Array.from({ length: 26 }, (_, i) => ({
        id: `bank:${i + 1}`,
        collectionId: 'bank',
        categories: [],
        question: { text: '界'.repeat(50_000), imageIds: [] },
        answer: { text: '界'.repeat(50_000), imageIds: [] },
        source: { cardId: `${i + 1}`, noteId: `${i + 1}`, noteGuid: 'guid', templateOrdinal: 0 }
    }))
    let total = 0,
        batches = 0
    for await (const batch of cardBatches(cards)) {
        expect(new TextEncoder().encode(JSON.stringify(batch)).length).toBeLessThan(900_000)
        total += batch.length
        batches++
    }
    expect(total).toBe(26)
    expect(batches).toBeGreaterThan(2)
})
