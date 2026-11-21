import { getStoredImage } from '@/lib/catalog'
export async function GET(_request: Request, context: RouteContext<'/api/images/[imageId]'>) {
    const { imageId } = await context.params
    if (!/^[a-f0-9]{64}$/.test(imageId)) return new Response('Image not found', { status: 404 })
    try {
        const image = await getStoredImage(imageId)
        if (!image) return new Response('Image not found', { status: 404 })
        return new Response(null, {
            status: 307,
            headers: { Location: image.url, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }
        })
    } catch {
        return new Response('Image unavailable', { status: 503 })
    }
}
