const rootSources = new Set(['ContentView.swift', 'RetenioApp.swift'])
const sources = new Map<string, string>()
const errors: string[] = []

for (const path of new Bun.Glob('**/*.swift').scanSync({ cwd: 'retenio', onlyFiles: true, dot: true })) {
    const name = path.split('/').at(-1)!
    if (!path.includes('/') && !rootSources.has(name)) {
        errors.push(`Move retenio/${path} into its responsibility folder.`)
    }
    const previous = sources.get(name)
    if (previous) errors.push(`Duplicate Swift filename: retenio/${previous} and retenio/${path}`)
    sources.set(name, path)
}

if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
}
