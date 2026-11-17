import { ConvexHttpClient } from 'convex/browser'
import type { ImportPlan } from '../bank-types'
import { uploadBank } from './upload'
let controller: AbortController | null = null
self.onmessage = async (event: MessageEvent<{ type: 'cancel' } | { type: 'upload'; file: File; plan: ImportPlan; key: string; name: string; url: string }>) => {
    if (event.data.type === 'cancel') {
        controller?.abort()
        return
    }
    controller = new AbortController()
    try {
        const { file, plan, key, name, url } = event.data
        const result = await uploadBank({
            client: new ConvexHttpClient(url),
            file,
            plan,
            key,
            name,
            signal: controller.signal,
            onProgress: (progress) => self.postMessage({ type: 'progress', progress })
        })
        self.postMessage({ type: 'done', result })
    } catch (error) {
        self.postMessage({
            type: 'error',
            message: controller.signal.aborted
                ? 'Import canceled. Incomplete uploads will be cleaned up.'
                : error instanceof Error
                  ? error.message
                  : 'Import failed. Please retry.'
        })
    }
}
