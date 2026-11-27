import Foundation
import SQLite3

nonisolated struct StudyCard: Codable, Sendable, Identifiable {
    let id: String
    let deck: String
    let question: String
    let answer: String
    var images: [String] = []
}

nonisolated struct DeckSummary: Identifiable, Sendable {
    var id: Data { Data(name.utf8) }
    let name: String
    let count: Int
}

nonisolated enum LibraryError: Error, LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        if case .invalid(let message) = self { return message }
        return nil
    }
}

/// All SQLite access is serialized by the actor, away from the UI actor.
actor LocalLibrary {
    static let shared = LocalLibrary()
    private var database: OpaquePointer?
    private let directory: URL

    init(directory: URL? = nil) {
        self.directory =
            directory ?? URL.applicationSupportDirectory.appendingPathComponent("Retenio", isDirectory: true)
    }

    deinit { if let database { sqlite3_close(database) } }

    private func open() throws {
        guard database == nil else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var handle: OpaquePointer?
        guard sqlite3_open(directory.appendingPathComponent("library.sqlite").path, &handle) == SQLITE_OK else {
            if let handle { sqlite3_close(handle) }
            throw LibraryError.invalid("Couldn't open the card library.")
        }
        database = handle
        do {
            try execute("PRAGMA foreign_keys = ON")
            let version = try rows("PRAGMA user_version").first?.first.flatMap(Int.init) ?? 0
            guard version <= 1 else { throw LibraryError.invalid("This library needs a newer version of Retenio.") }
            if version == 0 {
                try transaction {
                    try execute(
                        "CREATE TABLE cards (id TEXT PRIMARY KEY, deck TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, images TEXT NOT NULL, due REAL NOT NULL DEFAULT 0, interval REAL NOT NULL DEFAULT 0, repetitions INTEGER NOT NULL DEFAULT 0)"
                    )
                    try execute("CREATE INDEX cards_due ON cards(due, deck)")
                    try execute(
                        "CREATE TABLE reviews (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), rating TEXT NOT NULL, reviewed_at REAL NOT NULL, next_due REAL NOT NULL)"
                    )
                    try execute("PRAGMA user_version = 1")
                }
            }
        } catch {
            sqlite3_close(handle)
            database = nil
            throw error
        }
    }

    func decks() throws -> [DeckSummary] {
        try open()
        return try rows("SELECT deck, count(*) FROM cards GROUP BY deck ORDER BY deck COLLATE NOCASE")
            .map { DeckSummary(name: $0[0], count: Int($0[1]) ?? 0) }
    }

    /// Reimport changes content only; scheduling and review history remain intact.
    func upsert(_ cards: [StudyCard]) throws {
        try open()
        let encoder = JSONEncoder()
        try transaction {
            for card in cards {
                guard !card.id.isEmpty, !card.deck.isEmpty, !card.question.isEmpty, !card.answer.isEmpty else {
                    throw LibraryError.invalid("A card has missing content.")
                }
                let images = String(decoding: try encoder.encode(card.images), as: UTF8.self)
                try execute(
                    "INSERT INTO cards(id,deck,question,answer,images) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET deck=excluded.deck, question=excluded.question, answer=excluded.answer, images=excluded.images",
                    [card.id, card.deck, card.question, card.answer, images], )
            }
        }
    }

    // Statements are always bound; tool arguments and imported text never become SQL.
    private func rows(_ sql: String, _ values: [String] = []) throws -> [[String]] {
        guard let database else { throw LibraryError.invalid("The library isn't open.") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { throw databaseError() }
        defer { sqlite3_finalize(statement) }
        for (index, value) in values.enumerated() {
            guard
                sqlite3_bind_text(
                    statement, Int32(index + 1), value, Int32(value.utf8.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self), )
                    == SQLITE_OK
            else { throw databaseError() }
        }
        var result: [[String]] = []
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return result }
            guard status == SQLITE_ROW else { throw databaseError() }
            result.append(
                (0..<sqlite3_column_count(statement)).map { column in
                    guard let value = sqlite3_column_text(statement, column) else { return "" }
                    return String(
                        decoding: UnsafeBufferPointer(start: value, count: Int(sqlite3_column_bytes(statement, column))),
                        as: UTF8.self, )
                })
        }
    }

    private func execute(_ sql: String, _ values: [String] = []) throws { _ = try rows(sql, values) }
    private func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do {
            try body()
            try execute("COMMIT")
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }
    private func databaseError() -> LibraryError { .invalid("Couldn't read or save the local library.") }
}
