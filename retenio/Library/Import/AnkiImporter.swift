import CryptoKit
import Foundation
import ImageIO
import SQLite3

nonisolated struct AnkiImport: Sendable {
    let cards: [StudyCard]
    let media: [String: Data]
}

nonisolated enum AnkiImporter {
    static func read(_ url: URL) throws -> AnkiImport {
        let archive = try AnkiArchive(url: url)
        guard !archive.names.contains("collection.anki21b") else {
            throw LibraryError.invalid("In Anki, export again with ‘Support older Anki versions’ enabled.")
        }
        let databaseName = archive.names.contains("collection.anki21") ? "collection.anki21" : "collection.anki2"
        let database = try archive.read(databaseName, limit: 64 * 1024 * 1024)
        let mapping = try JSONDecoder().decode(
            [String: String].self, from: archive.read("media", limit: 8 * 1024 * 1024), )
        guard Set(mapping.values).count == mapping.count,
            mapping.keys.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) })
        else {
            throw LibraryError.invalid("Invalid Anki media map.")
        }
        let byName = Dictionary(uniqueKeysWithValues: mapping.map { ($0.value, $0.key) })
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        let databaseURL = temporary.appendingPathComponent("collection.sqlite")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try database.write(to: databaseURL)
        var db: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            if let db { sqlite3_close(db) }
            throw LibraryError.invalid("Couldn't read the Anki database.")
        }
        defer { sqlite3_close(db) }
        sqlite3_limit(db, SQLITE_LIMIT_LENGTH, 2 * 1024 * 1024)
        sqlite3_limit(db, SQLITE_LIMIT_COLUMN, 100)
        _ = try query(db, "PRAGMA trusted_schema=OFF", limit: 1)
        let deadline = UnsafeMutablePointer<Double>.allocate(capacity: 1)
        deadline.initialize(to: Date.timeIntervalSinceReferenceDate + 15)
        sqlite3_progress_handler(
            db, 1000,
            { pointer in
                guard let pointer else { return 1 }
                return Date.timeIntervalSinceReferenceDate > pointer.assumingMemoryBound(to: Double.self).pointee
                    ? 1 : 0
            }, deadline, )
        defer {
            sqlite3_progress_handler(db, 0, nil, nil)
            deadline.deinitialize(count: 1)
            deadline.deallocate()
        }
        let tables = try query(
            db,
            "SELECT name FROM sqlite_master WHERE type='table' AND sql NOT LIKE 'CREATE VIRTUAL%' AND name IN ('col','notes','cards')",
            limit: 3, )
        guard Set(tables.map { $0[0] }) == Set(["col", "notes", "cards"]) else {
            throw LibraryError.invalid("The package must contain ordinary Anki tables.")
        }
        let metadata = try query(db, "SELECT ver,models,decks FROM col", limit: 1)
        guard let collection = metadata.first, collection[0] == "11",
            let models = try JSONSerialization.jsonObject(with: Data(collection[1].utf8)) as? [String: [String: Any]],
            let decks = try JSONSerialization.jsonObject(with: Data(collection[2].utf8)) as? [String: [String: Any]]
        else {
            throw LibraryError.invalid("Unsupported Anki schema. Export with ‘Support older Anki versions’ enabled.")
        }
        let records = try query(
            db,
            "SELECT c.ord,c.did,c.odid,n.guid,n.mid,n.flds,n.tags FROM cards c LEFT JOIN notes n ON c.nid=n.id ORDER BY c.id",
            limit: 50000, )
        var cards: [StudyCard] = []
        var media: [String: Data] = [:]
        var names: [String: String] = [:]
        var mediaBytes = 0
        var textBytes = 0
        for record in records {
            try Task.checkCancellation()
            guard let ordinal = Int(record[0]), ordinal >= 0, ordinal < Int.max, !record[3].isEmpty,
                let model = models[record[4]], let definitions = model["flds"] as? [[String: Any]],
                let templates = model["tmpls"] as? [[String: Any]],
                let deck = decks[record[2] == "0" ? record[1] : record[2]]?["name"] as? String
            else {
                throw LibraryError.invalid("An Anki card has missing fields or a missing deck.")
            }
            let values = record[5].components(separatedBy: "\u{1f}")
            guard definitions.count == values.count else {
                throw LibraryError.invalid("Anki field count doesn't match its note type.")
            }
            var fields: [String: String] = [:]
            for definition in definitions {
                guard let name = definition["name"] as? String, let index = definition["ord"] as? Int,
                    values.indices.contains(index)
                else { throw LibraryError.invalid("Invalid Anki field definition.") }
                fields[name] = values[index]
            }
            fields["Deck"] = deck
            fields["Subdeck"] = deck.components(separatedBy: "::").last ?? deck
            fields["Tags"] = record[6]
            fields["Type"] = model["name"] as? String ?? ""
            fields["CardFlag"] = ""
            let cloze = model["type"] as? Int == 1
            guard let template = templates.first(where: { ($0["ord"] as? Int) == (cloze ? 0 : ordinal) }),
                let front = template["qfmt"] as? String, let back = template["afmt"] as? String
            else { throw LibraryError.invalid("Missing Anki template.") }
            let questionHTML = try AnkiTemplate.render(front, fields: fields, ordinal: ordinal, answer: false)
            // FrontSide belongs to the question, not the answer spoken after grading.
            fields["FrontSide"] = ""
            let answerHTML = try AnkiTemplate.render(back, fields: fields, ordinal: ordinal, answer: true)
            let questionImages = AnkiTemplate.images(questionHTML)
            let answerImages = AnkiTemplate.images(answerHTML)
            let referenced = Set(questionImages + answerImages).sorted()
            var ids: [String] = []
            for name in referenced {
                if let existing = names[name] {
                    ids.append(existing)
                    continue
                }
                guard let entry = byName[name] else {
                    throw LibraryError.invalid("An image is missing from the Anki package: \(name)")
                }
                let data = try archive.read(entry, limit: 16 * 1024 * 1024)
                guard let image = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(image) > 0
                else { throw LibraryError.invalid("Unsupported card image: \(name)") }
                let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                mediaBytes += data.count
                media[hash] = data
                guard mediaBytes <= 128 * 1024 * 1024 else {
                    throw LibraryError.invalid("The deck's images are too large. Export smaller decks.")
                }
                names[name] = hash
                ids.append(hash)
            }
            let question = AnkiTemplate.plain(questionHTML)
            let answer = AnkiTemplate.plain(answerHTML)
            guard !question.isEmpty || !questionImages.isEmpty,
                !answer.isEmpty || !answerImages.isEmpty
            else {
                throw LibraryError.invalid(
                    "A card has an empty question or answer. Audio-only cards aren't supported yet.")
            }
            textBytes += question.utf8.count + answer.utf8.count + deck.utf8.count + record[3].utf8.count + ids.count * 67 + 64
            guard textBytes <= 16 * 1024 * 1024 else {
                throw LibraryError.invalid("The deck contains too much card data. Export a smaller deck.")
            }
            cards.append(
                StudyCard(
                    id: "\(record[3]):\(ordinal)", deck: deck,
                    question: question.isEmpty ? "[Image-based question]" : question,
                    answer: answer.isEmpty ? "[Image-based answer]" : answer, images: ids, ))
        }
        guard !cards.isEmpty, Set(cards.map(\.id)).count == cards.count else {
            throw LibraryError.invalid("The package is empty or contains duplicate card identities.")
        }
        return AnkiImport(cards: cards, media: media)
    }

    private static func query(_ database: OpaquePointer?, _ sql: String, limit: Int) throws -> [[String]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw LibraryError.invalid("Unsupported Anki database.")
        }
        defer { sqlite3_finalize(statement) }
        var result: [[String]] = []
        var copiedBytes = 0
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return result }
            guard status == SQLITE_ROW, result.count < limit else {
                throw LibraryError.invalid("Damaged database or too many cards. Export a smaller deck.")
            }
            // The join may repeat a large note for many cards. Budget bytes before copying any row.
            copiedBytes += (0..<sqlite3_column_count(statement)).reduce(0) {
                $0 + Int(sqlite3_column_bytes(statement, $1))
            }
            guard copiedBytes <= 16 * 1024 * 1024 else {
                throw LibraryError.invalid("The Anki query contains too much text. Export a smaller deck.")
            }
            result.append(
                (0..<sqlite3_column_count(statement)).map { column in
                    guard let text = sqlite3_column_text(statement, column) else { return "" }
                    return String(
                        decoding: UnsafeBufferPointer(start: text, count: Int(sqlite3_column_bytes(statement, column))),
                        as: UTF8.self, )
                })
        }
    }
}
