import path from 'node:path'
import { loadCatalog, type Catalog } from './anki-data'

let catalogPromise: Promise<Catalog> | undefined

export function getCatalog() {
    catalogPromise ??= loadCatalog(path.join(process.cwd(), 'data')).catch((error) => {
        catalogPromise = undefined
        throw error
    })
    return catalogPromise
}
