import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
import initSqlJs from 'sql.js'
export async function fixturePackage({ missingImage = false, modern = false } = {}) {
    const SQL = await initSqlJs(),
        db = new SQL.Database()
    const model = {
        name: 'Basic',
        type: 0,
        flds: [
            { name: 'Front', ord: 0 },
            { name: 'Back', ord: 1 }
        ],
        tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }]
    }
    db.run(
        'create table col (ver integer, models text, decks text); create table notes (id integer,mid integer,flds text,tags text,guid text); create table cards (id integer,nid integer,did integer,odid integer,ord integer)'
    )
    db.run('insert into col values (11,?,?)', [JSON.stringify({ 1: model }), JSON.stringify({ 1: { name: 'Test Bank::1 Topic::1.1 - Leaf' } })])
    db.run("insert into notes values (2,1,?,'','stable-guid')", ['What is <b>two plus two</b>?\x1fFour &amp; more.<img src="picture.png">'])
    db.run('insert into cards values (1,2,1,0,0)')
    const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false })
    await writer.add(modern ? 'collection.anki21b' : 'collection.anki2', new Uint8ArrayReader(db.export()))
    await writer.add('media', new TextReader(JSON.stringify({ 0: 'picture.png' })))
    if (!missingImage)
        await writer.add(
            '0',
            new Uint8ArrayReader(
                Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
            )
        )
    db.close()
    return { file: await writer.close(), SQL }
}
