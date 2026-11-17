import initSqlJs from 'sql.js/dist/sql-wasm-browser.js'
import { readPackage } from './package'
self.onmessage = async (event: MessageEvent<{ file: File; origin: string }>) => {
    try {
        const SQL = await initSqlJs({ locateFile: () => `${event.data.origin}/api/import/sqlite?v=1.16.0` })
        const plan = await readPackage(event.data.file, SQL, (progress) => self.postMessage({ type: 'progress', progress }))
        self.postMessage({ type: 'ready', plan })
    } catch (error) {
        self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not read this Anki package' })
    }
}
