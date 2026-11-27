import Foundation
import Observation

nonisolated enum ConversationVoice: String, CaseIterable, Identifiable {
    case marin, cedar, coral, sage, ash, ballad, echo, shimmer, verse, alloy
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

nonisolated enum AppTheme: String, CaseIterable, Identifiable {
    case evergreen, midnight, plum
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

    var theme: AppTheme {
        didSet { defaults.set(theme.rawValue, forKey: "appTheme") }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        theme = AppTheme(rawValue: defaults.string(forKey: "appTheme") ?? "") ?? .evergreen
        voice = ConversationVoice(rawValue: defaults.string(forKey: "conversationVoice") ?? "") ?? .marin
    }
}
