export type CardSide = { text: string; imageIds: string[] }
export type BankCard = {
    id: string
    collectionId: string
    categories: string[]
    question: CardSide
    answer: CardSide
    source: { cardId: string; noteId: string; noteGuid: string; templateOrdinal: number }
}
export type ImportImage = { hash: string; entry: string; mimeType: string; bytes: number }
export type ImportPlan = { cards: BankCard[]; images: ImportImage[]; suggestedName: string; imageBytes: number }
export type ImportProgress = { message: string; completed: number; total: number }
