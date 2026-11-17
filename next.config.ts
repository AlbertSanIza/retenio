import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    outputFileTracingIncludes: { '/api/import/sqlite': ['./node_modules/sql.js/dist/sql-wasm-browser.wasm'] },
    /* config options here */
    experimental: {
        agentFeedback: true
    },
    cacheComponents: true,
    partialPrefetching: true,
    turbopack: {
        rules: {
            '*.css': {
                loaders: ['@tailwindcss/turbopack'],
                as: '*.css'
            }
        }
    }
}

export default nextConfig
