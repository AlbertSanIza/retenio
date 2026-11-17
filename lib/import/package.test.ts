import { expect, test } from 'bun:test'
import { readPackage } from './package'
import { plainSide, renderCard } from './render'
import { fixturePackage } from './test-package'

test('imports actual SQLite from APKG with stable IDs, cleaned templates and deduplicated image references', async () => {
    const { file, SQL } = await fixturePackage(),
        plan = await readPackage(file, SQL)
    expect(plan.cards).toHaveLength(1)
    expect(plan.cards[0].id).toBe('1')
    expect(plan.cards[0].categories).toEqual(['Topic', 'Leaf'])
    expect(plan.cards[0].question.text).toBe('What is two plus two?')
    expect(plan.cards[0].answer.text).toBe('Four & more.')
    expect(plan.cards[0].answer.imageIds).toEqual([plan.images[0].hash])
    expect(await readPackage(file, SQL)).toEqual(plan)
})
test('missing media and modern compressed packages fail with actionable errors', async () => {
    const missing = await fixturePackage({ missingImage: true })
    await expect(readPackage(missing.file, missing.SQL)).rejects.toThrow('Image is missing')
    const modern = await fixturePackage({ modern: true })
    await expect(readPackage(modern.file, modern.SQL)).rejects.toThrow('Support older Anki versions')
})
test('cloze, conditions, unsafe HTML and unsupported audio', () => {
    const model = {
        name: 'Cloze',
        type: 1,
        flds: [],
        tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}{{#Extra}}<br>{{Extra}}{{/Extra}}' }]
    }
    expect(renderCard(model, 0, { Text: '{{c1::Heart::organ}} pumps {{c2::blood}}.', Extra: 'More' })).toEqual([
        '[organ] pumps blood.',
        'Heart pumps blood.<br>More'
    ])
    expect(plainSide('<script>alert(1)</script><b>Safe &amp; plain</b><style>p{}</style>').text).toBe('Safe & plain')
    expect(() => plainSide('[sound:file.mp3]')).toThrow('Audio')
    expect(() => renderCard(model, 0, { Text: '{{c1::nested {{c2::bad}}}}', Extra: '' })).toThrow('Nested cloze')
})

test('literal percent filenames, remote media, and interactive templates get safe handling', () => {
    expect(plainSide('<img src="50%.png">').images).toEqual(['50%.png'])
    expect(plainSide('<img src="my%20image.png">').images).toEqual(['my image.png'])
    for (const src of ['https://example.com/pic.png', 'data:image/png;base64,abc', '//example.com/pic.png'])
        expect(() => plainSide(`<img src="${src}">`)).toThrow('Include the image files')
    const basic = { name: 'Basic', type: 0, flds: [], tmpls: [{ name: 'Card', ord: 0, qfmt: '{{type:Answer}}', afmt: '{{Answer}}' }] }
    expect(() => renderCard(basic, 0, { Answer: 'Answer' })).toThrow('Interactive')
    const cloze = { ...basic, type: 1, tmpls: [{ ...basic.tmpls[0], qfmt: '{{cloze:Answer}}' }] }
    expect(() => renderCard(cloze, 1, { Answer: '{{c1::visible}}' })).toThrow('no matching hidden text')
})
test('inverse conditions and tables preserve text without executing HTML', () => {
    const basic = {
        name: 'Basic',
        type: 0,
        flds: [],
        tmpls: [{ name: 'Card', ord: 0, qfmt: '{{^Extra}}Question{{/Extra}}', afmt: '<table><tr><td>A</td><td>B</td></tr></table><br>Explanation' }]
    }
    const rendered = renderCard(basic, 0, { Extra: '' })
    expect(rendered[0]).toBe('Question')
    expect(plainSide(rendered[1]).text).toContain('A | B')
})

test('SketchyPharm only imports the matching answer and image group', () => {
    const model = {
        name: 'SketchyPharm',
        type: 0,
        flds: [],
        tmpls: [{ name: 'Extra 8', ord: 7, qfmt: '{{Extra Q8}}', afmt: '{{Extra Q8}}{{Extra A8}}{{Extra 8}}{{Entire Sketch}}{{More About This Topic}}' }]
    }
    const [front, back] = renderCard(model, 7, {
        'Extra Q8': 'Question?',
        'Extra A8': 'Specific answer',
        'Extra 8': '<img src="specific.png">',
        'Entire Sketch': '<img src="entire.png">',
        'More About This Topic': 'Unrelated title'
    })
    expect(plainSide(front).text).toBe('Question?')
    expect(plainSide(back)).toEqual({ text: 'Specific answer', images: ['specific.png'] })
})
