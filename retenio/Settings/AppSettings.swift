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
    static let shared: AppSettings = {
        #if DEBUG
            let environment = ProcessInfo.processInfo.environment
            if let suite = environment["RETENIO_TEST_DEFAULTS_SUITE"], suite.hasPrefix("RetenioUITests."),
                let defaults = UserDefaults(suiteName: suite)
            {
                if environment["RETENIO_TEST_RESET_PREFERENCES"] == "1" {
                    defaults.removePersistentDomain(forName: suite)
                }
                return AppSettings(defaults: defaults)
            }
        #endif
        return AppSettings()
    }()
    private let defaults: UserDefaults
    var voice: ConversationVoice {
        didSet { defaults.set(voice.rawValue, forKey: "conversationVoice") }
    }

    var theme: AppTheme {
        didSet { defaults.set(theme.rawValue, forKey: "appTheme") }
    }

    var ai: AISettings {
        didSet { if let data = try? JSONEncoder().encode(ai) { defaults.set(data, forKey: "aiSettings") } }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if defaults.object(forKey: "aiSettings") != nil {
            ai = defaults.data(forKey: "aiSettings").flatMap { try? JSONDecoder().decode(AISettings.self, from: $0) } ?? .restricted
        } else {
            ai = AISettings()
        }
        theme = AppTheme(rawValue: defaults.string(forKey: "appTheme") ?? "") ?? .evergreen
        voice = ConversationVoice(rawValue: defaults.string(forKey: "conversationVoice") ?? "") ?? .marin
    }
}
