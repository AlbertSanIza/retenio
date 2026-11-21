import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { BlobReader, BlobWriter, ZipReader, type FileEntry } from '@zip.js/zip.js'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import type { BankCard, ImportPlan, ImportProgress } from '../bank-types'
import { sha256 } from './package'

type Client = {
    query<Q extends FunctionReference<'query'>>(query: Q, args: FunctionArgs<Q>): Promise<FunctionReturnType<Q>>
    mutation<M extends FunctionReference<'mutation'>>(mutation: M, args: FunctionArgs<M>): Promise<FunctionReturnType<M>>
}
export function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    if (value !== null && typeof value === 'object')
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
            .join(',')}}`
    return JSON.stringify(value)
}
export function bankKey(name: string) {
    const normalized = name.trim().normalize('NFKC')
    const slug = normalized
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80)
        .replace(/-$/, '')
    // Preserve established ASCII keys; use a deterministic 64-bit name hash
    // for names that have no Latin characters (without truncating the name).
    let hash = BigInt('14695981039346656037')
    for (const byte of new TextEncoder().encode(normalized)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * BigInt('1099511628211'))
    return slug || (normalized ? `bank-${hash.toString(16).padStart(16, '0')}` : '')
}
export async function* cardBatches(cards: BankCard[]) {
    let batch: { card: BankCard; digest: string }[] = [],
        bytes = 2
    for (const card of cards) {
        const item = { card, digest: await sha256(stableJson(card)) }
        const size = new TextEncoder().encode(JSON.stringify(item)).length + 1
        if (size > 900_000) throw new Error(`Question ${card.id} is too large to import`)
        if (batch.length && (batch.length === 25 || bytes + size > 900_000)) {
            yield batch
            batch = []
            bytes = 2
        }
        batch.push(item)
        bytes += size
    }
    if (batch.length) yield batch
}
export async function uploadBank({
    client,
    file,
    plan,
    key,
    name,
    signal,
    onProgress
}: {
    client: Client
    file: Blob
    plan: ImportPlan
    key: string
    name: string
    signal: AbortSignal
    onProgress: (p: ImportProgress) => void
}) {
    signal.throwIfAborted()
    onProgress({ message: 'Preparing your bank', completed: 0, total: 1 })
    const existing = (await client.query(api.library.collections, {})).find((c) => c.key === key)
    const merged = new Map<string, BankCard>()
    if (existing?.activeImportId) {
        let cursor: string | null = null
        for (;;) {
            signal.throwIfAborted()
            const page: { page: BankCard[]; isDone: boolean; continueCursor: string } = await client.query(api.library.page, {
                importId: existing.activeImportId,
                paginationOpts: { numItems: 20, cursor }
            })
            for (const card of page.page) merged.set(card.id, card)
            if (page.isDone) break
            cursor = page.continueCursor
        }
    }
    for (const original of plan.cards) {
        const card = { ...original, id: `${key}:${original.source.cardId}`, collectionId: key }
        const previous = merged.get(card.id)
        if (previous && stableJson(previous.source) !== stableJson(card.source))
            throw new Error(`Question ID collision in ${card.id}. Choose a different bank name.`)
        merged.set(card.id, card)
    }
    const cards = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
    const hashes = [...new Set(cards.flatMap((c) => [...c.question.imageIds, ...c.answer.imageIds]))].sort()
    const imageMap = new Map(plan.images.map((i) => [i.hash, i]))
    const digest = await sha256(stableJson(cards))
    signal.throwIfAborted()
    const job = await client.mutation(api.imports.begin, {
        key,
        name,
        digest,
        expectedCards: cards.length,
        expectedImages: hashes.length,
        ...(existing?.activeImportId && { baseImportId: existing.activeImportId })
    })
    if (job.alreadyImported) return { count: cards.length, unchanged: true }
    const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false })
    const abort = new AbortController(),
        forwardAbort = () => abort.abort()
    signal.addEventListener('abort', forwardAbort, { once: true })
    if (signal.aborted) abort.abort()
    try {
        const entries = new Map((await reader.getEntries()).filter((e): e is FileEntry => !e.directory).map((e) => [e.filename, e]))
        let cursor = 0,
            completed = 0
        const workers = Array.from({ length: 3 }, async () => {
            while (cursor < hashes.length) {
                abort.signal.throwIfAborted()
                const hash = hashes[cursor++]
                const preparation = await client.mutation(api.imports.prepareImage, { importId: job.importId, hash })
                if (preparation.uploadUrl) {
                    const image = imageMap.get(hash),
                        entry = image && entries.get(image.entry)
                    if (!image || !entry) throw new Error('An existing bank image is missing. Re-upload its original package first.')
                    const blob = await entry.getData(new BlobWriter(image.mimeType), { signal: abort.signal })
                    abort.signal.throwIfAborted()
                    const response = await fetch(preparation.uploadUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': image.mimeType },
                        body: blob,
                        signal: abort.signal
                    })
                    if (!response.ok) throw new Error('Image upload failed. Check your connection and retry; completed images will be reused.')
                    const { storageId } = (await response.json()) as { storageId: Id<'_storage'> }
                    try {
                        await client.mutation(api.imports.finishImage, { importId: job.importId, hash, storageId })
                    } catch (error) {
                        await client.mutation(api.imports.discardUploadedImage, { storageId }).catch(() => {})
                        throw error
                    }
                }
                onProgress({ message: 'Uploading images', completed: ++completed, total: hashes.length })
            }
        })
        try {
            await Promise.all(workers)
        } catch (error) {
            abort.abort()
            await Promise.allSettled(workers)
            throw error
        }
        let saved = 0
        for await (const batch of cardBatches(cards)) {
            abort.signal.throwIfAborted()
            await client.mutation(api.imports.addCards, { importId: job.importId, cards: batch })
            saved += batch.length
            onProgress({ message: 'Saving questions', completed: saved, total: cards.length })
        }
        abort.signal.throwIfAborted()
        onProgress({ message: 'Finishing import', completed: 1, total: 1 })
        await client.mutation(api.imports.finish, { importId: job.importId })
        return { count: cards.length, unchanged: false }
    } catch (error) {
        if (signal.aborted) await client.mutation(api.imports.cancel, { importId: job.importId }).catch(() => {})
        throw error
    } finally {
        signal.removeEventListener('abort', forwardAbort)
        await reader.close()
    }
}
