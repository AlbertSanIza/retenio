import Foundation
import Testing

@testable import retenio

@MainActor struct AppSettingsTests {
    @Test func defaultsPersistenceAndInvalidValues() throws {
        let suite = "RetenioTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = AppSettings(defaults: defaults)
        #expect(settings.voice == .marin)
        #expect(settings.theme == .evergreen)
        settings.voice = .cedar
        settings.theme = .midnight
        let reopened = AppSettings(defaults: defaults)
        #expect(reopened.voice == .cedar)
        #expect(reopened.theme == .midnight)
        defaults.set("unknown", forKey: "conversationVoice")
        defaults.set("unknown", forKey: "appTheme")
        let fallback = AppSettings(defaults: defaults)
        #expect(fallback.voice == .marin)
        #expect(fallback.theme == .evergreen)
    }

    @Test func previewHasNoBackendTools() throws {
        let session = try #require(LiveSessionConfiguration.previewEvent["session"] as? [String: Any])
        #expect(session["delegation"] == nil)
        #expect((session["instructions"] as? String)?.contains("voice preview") == true)
    }
}
