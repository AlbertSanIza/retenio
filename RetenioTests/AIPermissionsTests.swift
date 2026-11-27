import Foundation
import Testing

@testable import retenio

@MainActor struct AIPermissionsTests {
    @Test(arguments: 0..<32)
    func advertisedToolsMatchPolicy(mask: Int) throws {
        var policy = AISettings()
        policy.webSearch = mask & 1 != 0
        policy.readCards = mask & 2 != 0
        policy.viewImages = mask & 4 != 0
        policy.saveRatings = mask & 8 != 0
        policy.endCall = mask & 16 != 0
        let event = LiveSessionConfiguration.event(voice: .cedar, permissions: policy)
        let session = try #require(event["session"] as? [String: Any])
        let delegation = try #require(session["delegation"] as? [String: Any])
        let response = try #require(delegation["responses"] as? [String: Any])
        let tools = try #require(response["tools"] as? [[String: Any]])
        #expect(tools.contains { $0["type"] as? String == "web_search" } == policy.webSearch)
        let names = Set(tools.compactMap { $0["name"] as? String })
        for name in [
            "list_decks", "get_next_card", "search_cards", "get_card_image", "request_rating", "rate_card", "end_call",
            "cancel_end_call",
        ] {
            #expect(names.contains(name) == policy.allows(name))
        }
        #expect(!policy.allows("unknown_action"))
    }

    @Test func disabledToolsCannotReadOrWrite() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = LocalLibrary(directory: root)
        try await library.upsert([StudyCard(id: "one:0", deck: "D", question: "Q", answer: "A")])
        var policy = AISettings()
        policy.readCards = false
        let tools = CardTools(library: library, permissions: policy)
        for name in ["list_decks", "get_next_card", "search_cards", "get_card_image", "request_rating", "rate_card"] {
            let result = await tools.run(name: name, arguments: "{}") as? String
            #expect(result?.contains("disabled") == true)
        }
        #expect(tools.currentCard == nil)
        #expect(try await library.findCards(deck: "", query: "", excluding: [], dueOnly: true).count == 1)
    }

    @Test(arguments: ReasoningEffort.allCases)
    func reasoningBudgetAndRecoveryRetainPermissions(effort: ReasoningEffort) throws {
        var policy = AISettings.restricted
        policy.model = .astra
        policy.reasoning = effort
        let update = LiveSessionConfiguration.recoveryEvent(permissions: policy)
        #expect(update["type"] as? String == "session.update")
        let session = try #require(update["session"] as? [String: Any])
        let delegation = try #require(session["delegation"] as? [String: Any])
        let response = try #require(delegation["responses"] as? [String: Any])
        #expect(response["model"] as? String == BackendModel.sol.rawValue)
        #expect(response["max_output_tokens"] as? Int == effort.outputTokenBudget)
        #expect((response["tools"] as? [[String: Any]])?.isEmpty == true)
        #expect(LiveSessionConfiguration.isBackendValidationError(["error": ["code": "responses_validation_failed"]]))
        #expect(!LiveSessionConfiguration.isBackendValidationError(["error": ["code": "authentication_failed"]]))
    }

    @Test func modelAndPermissionsPersistTogether() throws {
        let suite = "RetenioTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = AppSettings(defaults: defaults)
        settings.ai.model = .luna
        settings.ai.reasoning = .medium
        settings.ai.webSearch = false
        settings.ai.saveRatings = false
        let restored = AppSettings(defaults: defaults).ai
        #expect(restored.model == .luna)
        #expect(restored.reasoning == .medium)
        #expect(!restored.webSearch)
        #expect(!restored.saveRatings)
        defaults.set(Data("invalid".utf8), forKey: "aiSettings")
        let invalid = AppSettings(defaults: defaults).ai
        #expect(!invalid.webSearch)
        #expect(!invalid.readCards)
        #expect(!invalid.saveRatings)
    }

    @Test func wrongPreferenceTypeDoesNotEnablePermissions() throws {
        let suite = "RetenioTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("damaged", forKey: "aiSettings")
        let settings = AppSettings(defaults: defaults).ai
        #expect(!settings.webSearch)
        #expect(!settings.readCards)
        #expect(!settings.viewImages)
        #expect(!settings.saveRatings)
        #expect(!settings.endCall)
    }
}
