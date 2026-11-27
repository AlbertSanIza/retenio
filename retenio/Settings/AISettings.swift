import Foundation

nonisolated enum BackendModel: String, Codable, CaseIterable, Identifiable {
    case sol = "gpt-6.2-sol"
    case astra = "gpt-6.2-astra"
    case luna = "gpt-6-luna"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .sol: "GPT-6.2 Sol"
        case .astra: "GPT-6.2 Astra"
        case .luna: "GPT-6 Luna"
        }
    }
}

nonisolated enum ReasoningEffort: String, Codable, CaseIterable, Identifiable {
    case low, medium, high
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var outputTokenBudget: Int {
        switch self {
        case .low: 2400
        case .medium: 6000
        case .high: 12000
        }
    }
}

/// Captured at call start. Both advertised tools and local execution use this policy.
nonisolated struct AISettings: Codable, Sendable {
    var model: BackendModel = .sol
    var reasoning: ReasoningEffort = .low
    var webSearch = true
    var readCards = true
    var viewImages = true
    var saveRatings = true
    var endCall = true

    static var restricted: AISettings {
        AISettings(webSearch: false, readCards: false, viewImages: false, saveRatings: false, endCall: false)
    }

    func allows(_ name: String) -> Bool {
        switch name {
        case "list_decks", "get_next_card", "search_cards": readCards
        case "get_card_image": readCards && viewImages
        case "request_rating", "rate_card": readCards && saveRatings
        case "end_call", "cancel_end_call": endCall
        default: false
        }
    }

    var instructions: String {
        "Only use enabled tools. Web search is \(webSearch ? "enabled" : "disabled"); local cards are \(readCards ? "enabled" : "disabled"); card images are \(readCards && viewImages ? "enabled" : "disabled"); saving ratings is \(readCards && saveRatings ? "enabled" : "disabled"); voice hang-up is \(endCall ? "enabled" : "disabled"). Do not request disabled actions or claim they succeeded. When saving is disabled, do not ask for a rating; discuss the answer and move on."
    }
}
