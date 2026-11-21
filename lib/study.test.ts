import { describe, expect, test } from 'bun:test'
import { buildCollections, filterQuestions, matchesCategory, type LibraryCard, type StudyScope } from './study'

const cards: LibraryCard[] = [
    {
        id: 'first:1',
        collectionId: 'first',
        categories: ['Heart', 'Diuretics', 'Loop'],
        question: { text: 'First question', imageIds: [] },
        answer: { text: 'Secret answer', imageIds: [] }
    },
    {
        id: 'first:2',
        collectionId: 'first',
        categories: ['Heart', 'Diuretics', 'Other'],
        question: { text: 'Second question', imageIds: [] },
        answer: { text: 'Second answer', imageIds: [] }
    },
    {
        id: 'first:3',
        collectionId: 'first',
        categories: ['Heart', 'Diuretics II'],
        question: { text: 'Third question', imageIds: [] },
        answer: { text: 'Third answer', imageIds: [] }
    },
    {
        id: 'second:1',
        collectionId: 'second',
        categories: ['Heart', 'Diuretics'],
        question: { text: 'Fourth question', imageIds: [] },
        answer: { text: 'Fourth answer', imageIds: [] }
    },
    {
        id: 'first:4',
        collectionId: 'first',
        categories: ['Putting It Together'],
        question: { text: 'Short path', imageIds: [] },
        answer: { text: 'Answer', imageIds: [] }
    }
]
const scope: StudyScope = { collection: 'first', category: [], search: '', status: 'all' }

describe('Study categories and browsing', () => {
    test('filters by exact hierarchical segments at any depth', () => {
        expect(matchesCategory(['Heart', 'Diuretics II'], ['Heart', 'Diuretics'])).toBe(false)
        expect(filterQuestions(cards, { ...scope, category: ['Heart'] }).map((c) => c.id)).toEqual(['first:1', 'first:2', 'first:3'])
        expect(filterQuestions(cards, { ...scope, category: ['Heart', 'Diuretics'] }).map((c) => c.id)).toEqual(['first:1', 'first:2'])
        expect(filterQuestions(cards, { ...scope, category: ['Heart', 'Diuretics', 'Loop'] }).map((c) => c.id)).toEqual(['first:1'])
        expect(filterQuestions(cards, { ...scope, category: ['Missing'] })).toEqual([])
        expect(filterQuestions(cards, { ...scope, collection: undefined })).toHaveLength(5)
    })
    test('keeps collections separate and supports shallow paths', () => {
        const tree = buildCollections(cards)
        expect(tree).toHaveLength(2)
        expect(tree[0].count).toBe(4)
        expect(tree[0].categories.find((c) => c.name === 'Heart')?.count).toBe(3)
        expect(tree[0].categories.find((c) => c.name === 'Putting It Together')?.children).toEqual([])
        expect(tree[1].count).toBe(1)
    })
    test('searches question/category text, not hidden answers, and respects practice filters', () => {
        expect(filterQuestions(cards, { ...scope, search: 'LOOP' }).map((c) => c.id)).toEqual(['first:1'])
        expect(filterQuestions(cards, { ...scope, search: 'Secret answer' })).toEqual([])
        expect(filterQuestions(cards, { ...scope, status: 'approved' }, new Set(['first:2'])).map((c) => c.id)).toEqual(['first:2'])
        expect(filterQuestions(cards, { ...scope, status: 'new' }, new Set(['first:2']))).toHaveLength(3)
    })
})
