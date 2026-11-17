import type { Catalog } from './anki-data'

export function toQuizCard(card: Catalog['cards'][number]) {
    function cleanSide(side: typeof card.question) {
        const text = side.text
            .replace(/^§[ \t]*\n/, '')
            .replace(/\[Image: ([a-f0-9]{64})\]/g, (marker, id: string) => (side.imageIds.includes(id) ? '' : marker))
            .replace(/\n(?:[ \t]*\n)+/g, '\n\n')
            .trim()
        return { text, ...(side.imageIds.length > 0 && { imageIds: side.imageIds }) }
    }
    const question = cleanSide(card.question)
    const answer = cleanSide(card.answer)
    // Anki's FrontSide commonly repeats the question before the answer.
    if (question.text && answer.text.startsWith(`${question.text}\n`)) {
        answer.text = answer.text.slice(question.text.length).trim()
    }
    const deckParts = card.deck
        .split('::')
        .map((part) => part.trim())
        .filter(Boolean)
    const categories = (deckParts.length > 1 ? deckParts.slice(1) : deckParts)
        .map((part) => part.replace(/^\d+(?:\.\d+)*(?:\s*-\s*|\s+)/, '').trim())
        .filter(Boolean)
    return { id: card.id, ...(categories.length > 0 && { categories }), question, answer }
}

export type QuizCard = ReturnType<typeof toQuizCard>
export type QuestionSummary = Pick<QuizCard, 'id' | 'categories' | 'question'>
