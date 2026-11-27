import Foundation
import Testing

@testable import retenio

@MainActor struct SpokenRatingTests {
    @Test(arguments: ["good morning", "not easy", "she said good", "good or easy", "I think the answer is good"])
    func ambiguousSpeechDoesNotAuthorizeRating(text: String) {
        var confirmation = SpokenRating()
        confirmation.request(after: 1000)
        confirmation.receive(["start_ms": 1100, "end_ms": 1400, "delta": text])
        #expect(confirmation.choice == nil)
    }

    @Test func ignoresOldSpeechAndAcceptsAnExplicitFreshChoice() {
        var confirmation = SpokenRating()
        confirmation.receive(["start_ms": 100, "end_ms": 300, "delta": "Easy"])
        #expect(confirmation.choice == nil)
        confirmation.request(after: 1000)
        confirmation.receive(["start_ms": 100, "end_ms": 300, "delta": "Easy"])
        #expect(confirmation.choice == nil)
        confirmation.receive(["start_ms": 1200, "end_ms": 1300, "delta": "Ea"])
        confirmation.receive(["start_ms": 1300, "end_ms": 1400, "delta": "sy."])
        #expect(confirmation.choice == .easy)
        confirmation.request(after: 1500)
        #expect(confirmation.choice == nil)
    }

    @Test func serverBoundaryRejectsDelayedSpeechDespiteMicrophoneStartupOffset() {
        let boundary = RatingBoundary()
        #expect(
            boundary.cutoff(from: ["type": "session.instructions.appended", "client_event_id": "other", "end_ms": 9000])
                == nil)
        let acknowledgment: [String: Any] = [
            "type": "session.instructions.appended", "client_event_id": boundary.eventID, "end_ms": 9000,
        ]
        var confirmation = SpokenRating()
        confirmation.request(after: boundary.cutoff(from: acknowledgment)!)
        // The mic may only have sent 6000 ms; use the server's 9000 ms cutoff instead.
        let now = Date(timeIntervalSince1970: 100)
        confirmation.receive(["start_ms": 8000, "end_ms": 8500, "delta": "Good"], at: now)
        #expect(confirmation.confirmedChoice(at: now.addingTimeInterval(2)) == nil)
        confirmation.receive(["start_ms": 9200, "end_ms": 9400, "delta": "Easy"], at: now)
        #expect(confirmation.confirmedChoice(at: now.addingTimeInterval(2)) == .easy)
    }

    @Test func toolCannotSaveWithoutSpokenConsentAndRetriesStayIdempotent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        try await library.upsert([StudyCard(id: "one:0", deck: "D", question: "Q", answer: "A")])
        let tools = CardTools(library: library)
        _ = await tools.run(name: "get_next_card", arguments: #"{"deck":"D"}"#)
        let earlyToken = try #require(tools.reviewToken)
        func args(_ token: String, _ rating: String = "easy") -> String {
            "{\"card_id\":\"one:0\",\"rating\":\"\(rating)\",\"review_token\":\"\(token)\"}"
        }
        let unauthorized = await tools.run(name: "rate_card", arguments: args(earlyToken)) as? String
        #expect(unauthorized?.contains("Tool failed") == true)
        tools.ratingBoundaryMS = 1000
        _ = await tools.run(name: "request_rating", arguments: "{}")
        let token = try #require(tools.reviewToken)
        #expect(token != earlyToken)
        let now = Date(timeIntervalSince1970: 1000)
        tools.receiveTranscript(["start_ms": 1100, "end_ms": 1200, "delta": "Good"], at: now)
        tools.receiveTranscript(["start_ms": 4000, "end_ms": 4500, "delta": "Easy."], at: now.addingTimeInterval(3))
        let wrongChoice =
            await tools.run(name: "rate_card", arguments: args(token, "hard"), now: now.addingTimeInterval(5))
            as? String
        #expect(wrongChoice?.contains("Tool failed") == true)
        let saved =
            await tools.run(name: "rate_card", arguments: args(token), now: now.addingTimeInterval(5)) as? String
        #expect(saved?.contains("saved") == true)
        let retry =
            await tools.run(name: "rate_card", arguments: args(token), now: now.addingTimeInterval(5)) as? String
        #expect(saved == retry)
        #expect(tools.currentCard == nil)
        #expect(try await library.findCards(deck: "", query: "", excluding: [], dueOnly: true).isEmpty)
    }

    @Test func overflowRejectsTheWholeUtteranceUntilANewGap() {
        let now = Date(timeIntervalSince1970: 100)
        var rating = SpokenRating()
        rating.request(after: 100)
        rating.receive(["start_ms": 100, "end_ms": 200, "delta": String(repeating: " ", count: 400) + "Good"], at: now)
        rating.receive(["start_ms": 210, "end_ms": 220, "delta": "Good"], at: now)
        #expect(rating.confirmedChoice(at: now.addingTimeInterval(2)) == nil)
        rating.receive(["start_ms": 2000, "end_ms": 2100, "delta": "Good"], at: now)
        #expect(rating.confirmedChoice(at: now.addingTimeInterval(0.5)) == nil)
        #expect(rating.confirmedChoice(at: now.addingTimeInterval(2)) == .good)
        rating.receive(["start_ms": 2200, "end_ms": 2300, "delta": " or Easy"], at: now)
        #expect(rating.confirmedChoice(at: now.addingTimeInterval(2)) == nil)
    }

    @Test func malformedTimestampsDoNotAuthorizeOrExtendConsent() {
        let now = Date(timeIntervalSince1970: 100)
        var rating = SpokenRating()
        rating.request(after: 100)
        rating.receive(["start_ms": Double.infinity, "end_ms": Double.infinity, "delta": "Good"], at: now)
        rating.receive(["start_ms": 200, "end_ms": 150, "delta": "Good"], at: now)
        #expect(rating.choice == nil)
        rating.receive(["start_ms": 200, "end_ms": 300, "delta": "Good"], at: now)
        rating.receive(["start_ms": 200, "end_ms": 250, "delta": " or Easy"], at: now)
        rating.receive(["start_ms": 300, "end_ms": 400, "delta": ""], at: now.addingTimeInterval(1))
        #expect(rating.confirmedChoice(at: now.addingTimeInterval(1.3)) == .good)
    }

}
