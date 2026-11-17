import type { BankCard } from './bank-types'

export type CategoryNode = { name: string; path: string[]; count: number; children: CategoryNode[] }
export type CollectionTree = { id: string; name: string; count: number; categories: CategoryNode[] }
export type LibraryCard = Omit<BankCard, 'source'> & { dueAt?: number }
export type StudyScope = { collection?: string; category: string[]; search: string; status: 'all' | 'new' | 'approved' }
export type LibraryPage = {
    questions: Array<Pick<LibraryCard, 'id' | 'collectionId' | 'categories' | 'question' | 'dueAt'>>
    total: number
    page: number
    pageSize: number
    totalQuestions: number
    catalogCardIds: string[]
    collections: CollectionTree[]
}

export function matchesCategory(categories: string[] | undefined, prefix: string[]) {
    return prefix.every((part, index) => categories?.[index] === part)
}

export function filterQuestions(cards: LibraryCard[], scope: StudyScope, approvedIds: ReadonlySet<string> = new Set()) {
    const search = scope.search.trim().toLocaleLowerCase()
    return cards.filter(
        (card) =>
            (!scope.collection || card.collectionId === scope.collection) &&
            matchesCategory(card.categories, scope.category) &&
            (!search || `${card.question.text} ${(card.categories ?? []).join(' ')}`.toLocaleLowerCase().includes(search)) &&
            (scope.status === 'all' || approvedIds.has(card.id) === (scope.status === 'approved'))
    )
}

export function buildCollections(cards: LibraryCard[]): CollectionTree[] {
    const collections = new Map<string, CollectionTree>()
    for (const card of cards) {
        let collection = collections.get(card.collectionId)
        if (!collection) {
            collection = { id: card.collectionId, name: card.collectionId.replaceAll('-', ' '), count: 0, categories: [] }
            collections.set(card.collectionId, collection)
        }
        collection.count++
        let children = collection.categories
        const path: string[] = []
        for (const name of card.categories ?? []) {
            path.push(name)
            let node = children.find((item) => item.name === name)
            if (!node) {
                node = { name, path: [...path], count: 0, children: [] }
                children.push(node)
            }
            node.count++
            children = node.children
        }
    }
    function sort(nodes: CategoryNode[]) {
        nodes.sort((a, b) => a.name.localeCompare(b.name))
        for (const node of nodes) sort(node.children)
    }
    for (const collection of collections.values()) sort(collection.categories)
    return [...collections.values()].sort((a, b) => a.name.localeCompare(b.name))
}
