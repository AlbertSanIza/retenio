import { getCatalog } from '@/lib/catalog'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export async function GET(_request: Request, context: RouteContext<'/api/images/[imageId]'>) {
    const { imageId } = await context.params
    if (!/^[a-f0-9]{64}$/.test(imageId)) return new Response('Image not found', { status: 404 })
    try {
        const image = (await getCatalog()).media[imageId]
        if (!image) return new Response('Image not found', { status: 404 })
        const bytes = await readFile(image.url)
        if (bytes.length !== image.bytes || createHash('sha256').update(bytes).digest('hex') !== imageId) throw new Error('Invalid image contents')
        return new Response(new Uint8Array(bytes), {
            headers: {
                'Content-Type': image.mimeType,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff'
            }
        })
    } catch (error) {
        console.error('Unable to load study image:', error)
        return new Response('Image unavailable', { status: 503 })
    }
}
