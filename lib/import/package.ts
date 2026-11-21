import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js'
import type { SqlJsStatic } from 'sql.js'
import type { BankCard, ImportImage, ImportPlan, ImportProgress } from '../bank-types'
import { plainSide, renderCard, type AnkiModel } from './render'

export async function sha256(bytes: Uint8Array | string) {
    const input = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(input))), (b) => b.toString(16).padStart(2, '0')).join('')
}
export function imageMime(bytes: Uint8Array) {
    const starts = (...prefix: number[]) => prefix.every((b, i) => bytes[i] === b)
    if (starts(255, 216, 255)) return 'image/jpeg'
    if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png'
    const text = new TextDecoder().decode(bytes.slice(0, 12))
    if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif'
    if (text.startsWith('RIFF') && text.slice(8) === 'WEBP') return 'image/webp'
    throw new Error('Unsupported image format. Use JPEG, PNG, GIF, or WebP images.')
}
export async function readPackage(file: Blob, SQL: SqlJsStatic, progress: (p: ImportProgress) => void = () => {}): Promise<ImportPlan> {
    if (file.size > 512 * 1024 * 1024) throw new Error('Please use a package smaller than 512 MB')
    const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false })
    try {
        const entries = await reader.getEntries()
        if (entries.length > 60_000 || new Set(entries.map((e) => e.filename)).size !== entries.length)
            throw new Error('Package has too many files or duplicate entries')
        const files = new Map(entries.filter((e): e is FileEntry => !e.directory).map((e) => [e.filename, e]))
        if (files.has('collection.anki21b'))
            throw new Error(
                'This package uses Anki’s newer compressed format. In Anki, export it again with “Support older Anki versions” enabled, then upload the .apkg file.'
            )
        const database = files.get('collection.anki21') ?? files.get('collection.anki2'),
            mediaEntry = files.get('media')
        if (!database || !mediaEntry) throw new Error('This is not a supported Anki package')
        if (database.uncompressedSize > 64 * 1024 * 1024 || mediaEntry.uncompressedSize > 8 * 1024 * 1024)
            throw new Error('This bank is too large to unpack safely in the browser. Export it as smaller decks.')
        const media = JSON.parse(await mediaEntry.getData(new TextWriter())) as Record<string, string>
        const byName = new Map<string, string>()
        for (const [entry, name] of Object.entries(media)) {
            if (!/^\d+$/.test(entry) || typeof name !== 'string' || byName.has(name)) throw new Error('Invalid media names in this package')
            byName.set(name, entry)
        }
        progress({ message: 'Reading questions', completed: 0, total: 1 })
        const db = new SQL.Database(await database.getData(new Uint8ArrayWriter()))
        const cards: BankCard[] = [],
            referenced = new Set<string>(),
            roots = new Set<string>()
        try {
            const col = db.exec('select ver, models, decks from col')[0]?.values[0]
            if (!col || Number(col[0]) !== 11) throw new Error('Unsupported Anki database. Export with “Support older Anki versions” enabled.')
            const models = JSON.parse(String(col[1])) as Record<string, AnkiModel>
            const decks = JSON.parse(String(col[2])) as Record<string, { name: string }>
            const statement = db.prepare(
                'select c.id,c.nid,c.did,c.odid,c.ord,n.mid,n.flds,n.tags,n.guid from cards c join notes n on n.id=c.nid order by c.id'
            )
            try {
                while (statement.step()) {
                    if (cards.length >= 50_000) throw new Error('Please split banks with more than 50,000 questions into smaller decks')
                    const [cardId, noteId, deckId, originalDeckId, ordinal, modelId, values, tags, guid] = statement.get()
                    if (!Number.isSafeInteger(cardId) || Number(cardId) <= 0 || !Number.isSafeInteger(noteId) || Number(noteId) <= 0 || !guid)
                        throw new Error('A question is missing its Anki identity')
                    const model = models[String(modelId)],
                        deck = decks[String(originalDeckId || deckId)]?.name.trim()
                    if (!model || !deck) throw new Error('A question is missing its deck or note type')
                    const fieldValues = String(values).split('\x1f')
                    if (fieldValues.length !== model.flds.length) throw new Error(`Wrong field count in question ${cardId}`)
                    const fields = Object.fromEntries(model.flds.map((f) => [f.name, fieldValues[f.ord]]))
                    Object.assign(fields, { CardFlag: '', Tags: String(tags), Type: model.name, Deck: deck, Subdeck: deck.split('::').at(-1)! })
                    const [front, back] = renderCard(model, Number(ordinal), fields)
                    const question = plainSide(front),
                        answer = plainSide(back)
                    if (question.text && answer.text.startsWith(`${question.text}\n`)) answer.text = answer.text.slice(question.text.length).trim()
                    for (const name of [...question.images, ...answer.images]) referenced.add(name)
                    if ((!question.text && !question.images.length) || (!answer.text && !answer.images.length))
                        throw new Error(`Question ${cardId} has an empty question or answer`)
                    const path = deck
                        .split('::')
                        .map((p) => p.trim())
                        .filter(Boolean)
                    roots.add(path[0])
                    const categories = (path.length > 1 ? path.slice(1) : path)
                        .map((p) => p.replace(/^\d+(?:\.\d+)*(?:\s*-\s*|\s+)/, '').trim())
                        .filter(Boolean)
                    cards.push({
                        id: String(cardId),
                        collectionId: '',
                        categories,
                        question: { text: question.text, imageIds: question.images },
                        answer: { text: answer.text, imageIds: answer.images },
                        source: { cardId: String(cardId), noteId: String(noteId), noteGuid: String(guid), templateOrdinal: Number(ordinal) }
                    })
                }
            } finally {
                statement.free()
            }
        } finally {
            db.close()
        }
        if (!cards.length || new Set(cards.map((c) => c.id)).size !== cards.length) throw new Error('Package is empty or has duplicate question IDs')
        const byFilename = new Map<string, string>(),
            images = new Map<string, ImportImage>()
        let index = 0,
            imageBytes = 0
        for (const filename of referenced) {
            const entry = files.get(byName.get(filename) ?? '')
            if (!entry) throw new Error(`Image is missing from the package: ${filename}`)
            if (entry.uncompressedSize > 16 * 1024 * 1024) throw new Error(`Image is larger than 16 MB: ${filename}`)
            imageBytes += entry.uncompressedSize
            if (imageBytes > 1024 * 1024 * 1024) throw new Error('The extracted images exceed 1 GB. Please split this bank.')
            const bytes = await entry.getData(new Uint8ArrayWriter()),
                hash = await sha256(bytes),
                mimeType = imageMime(bytes)
            images.set(hash, { hash, entry: entry.filename, mimeType, bytes: bytes.length })
            byFilename.set(filename, hash)
            progress({ message: 'Checking images', completed: ++index, total: referenced.size })
        }
        for (const card of cards)
            for (const side of [card.question, card.answer]) side.imageIds = [...new Set(side.imageIds.map((name) => byFilename.get(name)!))]
        return {
            cards,
            images: [...images.values()].sort((a, b) => a.hash.localeCompare(b.hash)),
            suggestedName: roots.size === 1 ? [...roots][0] : 'My question bank',
            imageBytes: [...images.values()].reduce((sum, i) => sum + i.bytes, 0)
        }
    } finally {
        await reader.close()
    }
}
