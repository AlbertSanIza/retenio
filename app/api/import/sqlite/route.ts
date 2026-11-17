import { readFile } from 'node:fs/promises'
import path from 'node:path'
export async function GET() {
    const bytes = await readFile(path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm-browser.wasm'))
    return new Response(bytes, { headers: { 'Content-Type': 'application/wasm', 'Cache-Control': 'public, max-age=3600' } })
}
