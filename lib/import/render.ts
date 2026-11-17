import { Parser } from 'htmlparser2'

const blocks = new Set(['div', 'p', 'br', 'hr', 'li', 'ul', 'ol', 'tr', 'h1', 'h2', 'h3', 'center'])
export function plainSide(html: string) {
    const parts: string[] = [],
        images: string[] = []
    let hidden = 0
    if (/\[sound:[^\]]+\]/.test(html)) throw new Error('Audio cards are not supported yet. Import a bank with text and images.')
    const parser = new Parser(
        {
            onopentag(name, attrs) {
                if (name === 'script' || name === 'style') hidden++
                if (hidden) return
                if (blocks.has(name)) parts.push('\n')
                else if (name === 'td' || name === 'th') parts.push(' | ')
                else if (name === 'img') {
                    if (!attrs.src) throw new Error('An image has no source filename')
                    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attrs.src))
                        throw new Error('Remote and embedded image URLs are not supported. Include the image files in the Anki package.')
                    let filename = attrs.src
                    try {
                        filename = decodeURIComponent(filename)
                    } catch {
                        /* Literal percent signs are valid filenames. */
                    }
                    if (!images.includes(filename)) images.push(filename)
                    parts.push('\n\n')
                }
            },
            onclosetag(name, implied) {
                if (name === 'script' || name === 'style') hidden = Math.max(0, hidden - 1)
                else if (!hidden && !implied && blocks.has(name)) parts.push('\n')
            },
            ontext(text) {
                if (!hidden) parts.push(text)
            }
        },
        { decodeEntities: true }
    )
    parser.end(html)
    const text = parts
        .join('')
        .replace(/[^\S\n]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^§[ \t]*\n/, '')
        .trim()
    return { text, images }
}
export function renderTemplate(template: string, fields: Record<string, string>, ordinal: number, answer: boolean) {
    if (/<script\b/i.test(template)) throw new Error('Interactive Anki templates are not supported yet')
    const conditions: Array<{ name: string; enabled: boolean }> = [],
        output: string[] = []
    for (const part of template.split(/({{[^{}]+}})/)) {
        if (!part.startsWith('{{')) {
            if (conditions.every((c) => c.enabled)) output.push(part)
            continue
        }
        const token = part.slice(2, -2).trim()
        if (token.startsWith('#') || token.startsWith('^')) {
            const name = token.slice(1)
            if (!(name in fields)) throw new Error(`Unknown template field: ${name}`)
            const populated = !!fields[name].trim()
            conditions.push({ name, enabled: token[0] === '#' ? populated : !populated })
        } else if (token.startsWith('/')) {
            if (conditions.pop()?.name !== token.slice(1)) throw new Error('Unmatched template condition')
        } else {
            const filters = token.split(':'),
                name = filters.pop()!
            if (!(name in fields)) throw new Error(`Unknown template field: ${name}`)
            let value = fields[name]
            for (const filter of filters.reverse()) {
                if (filter === 'hint' || filter === 'type') throw new Error('Interactive hint fields are not supported yet')
                if (filter === 'text') value = value.replace(/<[^>]+>/g, '')
                else if (filter === 'cloze') {
                    if (!new RegExp(`{{c${ordinal + 1}::`).test(value))
                        throw new Error('This cloze card has no matching hidden text. Re-export the bank after removing empty Anki cards.')
                    value = value.replace(/{{c(\d+)::([\s\S]*?)}}/g, (_, index, content: string) => {
                        if (content.includes('{{')) throw new Error('Nested cloze cards are not supported yet')
                        const [text, hint] = content.split('::')
                        return Number(index) === ordinal + 1 && !answer ? `[${hint || '…'}]` : text
                    })
                } else throw new Error(`Unsupported Anki template filter: ${filter}`)
            }
            if (conditions.every((c) => c.enabled)) output.push(value)
        }
    }
    if (conditions.length) throw new Error('Unclosed template condition')
    return output.join('')
}
export type AnkiModel = {
    name: string
    type: number
    flds: Array<{ name: string; ord: number }>
    tmpls: Array<{ name: string; ord: number; qfmt: string; afmt: string }>
}
export function renderCard(model: AnkiModel, ordinal: number, fields: Record<string, string>) {
    const template = model.type === 1 ? model.tmpls[0] : model.tmpls.find((t) => t.ord === ordinal)
    if (!template || ![0, 1].includes(model.type)) throw new Error(`Unsupported note type: ${model.name}`)
    fields = { ...fields, Card: template.name }
    if (model.name === 'SketchyPharm') {
        const refs = (value: string) =>
            [
                ...new Set(
                    Array.from(value.matchAll(/{{([^{}]+)}}/g), (m) => m[1].trim())
                        .filter((t) => !/^[#^/]/.test(t))
                        .map((t) => t.split(':').at(-1)!)
                )
            ].sort()
        const front = refs(template.qfmt)
        const match = front.length === 1 && /^Extra Q(\d*)$/.exec(front[0])
        if (!match) throw new Error('Unsupported SketchyPharm question template')
        const suffix = match[1],
            question = front[0],
            answer = `Extra A${suffix}`,
            extra = suffix ? `Extra ${suffix}` : 'Extra'
        const expected = [question, answer, extra, 'Entire Sketch', 'More About This Topic'].sort()
        if (JSON.stringify(refs(template.afmt)) !== JSON.stringify(expected) || expected.some((k) => !(k in fields)))
            throw new Error('Unsupported SketchyPharm answer template')
        return [fields[question], `${fields[answer]}<br>${fields[extra]}`] as const
    }
    const front = renderTemplate(template.qfmt, fields, ordinal, false)
    return [front, renderTemplate(template.afmt, { ...fields, FrontSide: front }, ordinal, true)] as const
}
