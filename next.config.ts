import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    outputFileTracingIncludes: {
        '/api/mcp': ['./data/*/collection.json', './data/*/questions/*.json', './data/*/images/*'],
        '/api/questions': ['./data/*/collection.json', './data/*/questions/*.json'],
        '/api/questions/*': ['./data/*/collection.json', './data/*/questions/*.json'],
        '/api/images/*': ['./data/*/collection.json', './data/*/questions/*.json', './data/*/images/*']
    },
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
