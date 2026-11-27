import Foundation
import Testing

@testable import retenio

struct LocalLibraryTests {
    private func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("RetenioTests-\(UUID())")
    }

    @Test func reimportPreservesProgressAndReviewsAreIdempotent() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        try await library.upsert([StudyCard(id: "one:0", deck: "D", question: "Old", answer: "A")])
        let now = Date.now.addingTimeInterval(0.123456)
        let due = try await library.rate(cardID: "one:0", rating: .easy, reviewID: "r", now: now)
        let retry = try await library.rate(
            cardID: "one:0", rating: .easy, reviewID: "r", now: now.addingTimeInterval(60), )
        #expect(abs(due.timeIntervalSince(retry)) < 0.000001)
        await #expect(throws: LibraryError.self) {
            try await library.rate(cardID: "one:0", rating: .hard, reviewID: "r", now: now)
        }
        try await library.upsert([StudyCard(id: "one:0", deck: "D", question: "Updated", answer: "B")])
        let reopened = LocalLibrary(directory: root)
        #expect(try await reopened.findCards(deck: "", query: "", excluding: [], dueOnly: true).isEmpty)
        let updated = try await reopened.findCards(deck: "D", query: "Updated", excluding: [], dueOnly: false)
        #expect(updated.first?.answer == "B")
        #expect(try await reopened.decks().first?.count == 1)
    }

    @Test func overdueBeforeNewSiblingsExcludedAndQueriesBounded() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        let cards = (0..<100).map { StudyCard(id: "new\($0):0", deck: "D", question: "Q", answer: "A") }
        try await library.upsert(
            cards + [
                StudyCard(id: "old:0", deck: "D", question: "Old", answer: "A"),
                StudyCard(id: "old:1", deck: "D", question: "Reverse", answer: "A"),
            ])
        _ = try await library.rate(
            cardID: "old:0", rating: .good, reviewID: "r", now: Date(timeIntervalSince1970: 1000), )
        #expect(try await library.findCards(deck: "", query: "", excluding: [], dueOnly: true).first?.id == "old:0")
        let next = try await library.findCards(deck: "", query: "", excluding: [Data("old:0".utf8)], dueOnly: true)
        #expect(next.count == 1)
        #expect(next.first?.id.hasPrefix("new") == true)
        #expect(try await library.findCards(deck: "", query: "", excluding: [], dueOnly: false).count == 5)
        #expect(try await library.findCards(deck: "' OR 1=1 --", query: "", excluding: [], dueOnly: false).isEmpty)
    }

    @MainActor @Test func oversizedToolOutputFailsWithoutSendingCardText() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        try await library.upsert([
            StudyCard(id: "a:0", deck: "D", question: "First", answer: "A"),
            StudyCard(id: "b:0", deck: "D", question: String(repeating: "x", count: 300_000), answer: "A"),
            StudyCard(id: "c:0", deck: "D", question: "Last", answer: "A"),
        ])
        let tools = CardTools(library: library)
        let result = await tools.run(name: "search_cards", arguments: #"{"query":"x"}"#) as? String
        #expect(result?.contains("too large") == true)
        #expect((result?.utf8.count ?? 0) < 300)
        _ = await tools.run(name: "get_next_card", arguments: #"{"deck":"D"}"#)
        #expect(tools.currentCard?.id == "a:0")
        let next = await tools.run(name: "get_next_card", arguments: #"{"deck":"D"}"#) as? String
        #expect(next?.contains("too large") == true)
        #expect(tools.currentCard == nil)
        #expect(tools.reviewToken == nil)
        _ = await tools.run(name: "get_next_card", arguments: #"{"deck":"D"}"#)
        #expect(tools.currentCard?.id == "c:0")
    }

    @MainActor @Test func toolJSONPreservesCardAndDeckContracts() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        let card = StudyCard(id: "note:0", deck: "D", question: "A \"quote\" and \nline", answer: "B")
        try await library.upsert([card])
        let tools = CardTools(library: library)
        let deckJSON = try #require(await tools.run(name: "list_decks", arguments: "{}") as? String)
        let decks = try #require(JSONSerialization.jsonObject(with: Data(deckJSON.utf8)) as? [[String: Any]])
        #expect(decks.count == 1)
        #expect(decks[0]["name"] as? String == "D")
        #expect(decks[0]["count"] as? Int == 1)
        #expect(Set(decks[0].keys) == ["name", "count"])
        let selectionJSON = try #require(await tools.run(name: "get_next_card", arguments: #"{"deck":"D"}"#) as? String)
        let selection = try #require(JSONSerialization.jsonObject(with: Data(selectionJSON.utf8)) as? [String: Any])
        #expect(Set(selection.keys) == ["card", "review_token"])
        #expect(selection["review_token"] as? String == tools.reviewToken)
        let payload = try #require(selection["card"] as? [String: Any])
        #expect(payload["id"] as? String == card.id)
        #expect(payload["question"] as? String == card.question)
        #expect(payload["images"] as? [String] == [])
    }

    @Test func failedImportRollsBackCardsAndNewMedia() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        let image = String(repeating: "a", count: 64)
        let plan = AnkiImport(
            cards: [
                StudyCard(id: "valid", deck: "D", question: "Q", answer: "A"),
                StudyCard(id: "invalid", deck: "D", question: "", answer: "A"),
            ], media: [image: Data([1, 2, 3])], )
        await #expect(throws: LibraryError.self) { try await library.importDeck(plan) }
        #expect(try await library.decks().isEmpty)
        #expect(
            !FileManager.default.fileExists(
                atPath: root.appendingPathComponent("Media").appendingPathComponent(image).path))
    }

    @Test func embeddedNULAndUnicodeIdentitiesSurvivePersistence() async throws {
        let root = directory()
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        try await library.upsert([
            StudyCard(id: "one", deck: "D", question: "Q", answer: "A"),
            StudyCard(id: "one\0distinct", deck: "Null\0Deck", question: "Q\0rest", answer: "A\0rest"),
            StudyCard(id: "é:0", deck: "é", question: "Q", answer: "A"),
            StudyCard(id: "e\u{301}:0", deck: "e\u{301}", question: "Q", answer: "A"),
        ])
        let reopened = LocalLibrary(directory: root)
        let decks = try await reopened.decks()
        #expect(decks.count == 4)
        #expect(Set(decks.map(\.id)).count == 4)
        let card = try #require(try await reopened.findCards(deck: "Null\0Deck", query: "", excluding: [], dueOnly: false).first)
        #expect(Data(card.id.utf8) == Data("one\0distinct".utf8))
        #expect(card.question == "Q\0rest")
        #expect(card.answer == "A\0rest")
        _ = try await reopened.rate(cardID: "é:0", rating: .good, reviewID: "same")
        await #expect(throws: LibraryError.self) {
            try await reopened.rate(cardID: "e\u{301}:0", rating: .good, reviewID: "same")
        }
    }

}
