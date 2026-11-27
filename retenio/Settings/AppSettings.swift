import Foundation
import Observation

nonisolated enum ConversationVoice: String, CaseIterable, Identifiable {
    case marin, cedar, coral, sage, ash, ballad, echo, shimmer, verse, alloy
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

@MainActor @Observable
final class AppSettings {
    static let shared = AppSettings()
    private let defaults: UserDefaults
    var voice: ConversationVoice {
        didSet { defaults.set(voice.rawValue, forKey: "conversationVoice") }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        voice = ConversationVoice(rawValue: defaults.string(forKey: "conversationVoice") ?? "") ?? .marin
    }
}
