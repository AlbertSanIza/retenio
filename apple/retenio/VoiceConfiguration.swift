import Foundation

/// Temporary, owner-only prototype configuration. The bundled credential is extractable;
/// replace this with server-side session creation before distributing the app.
enum VoiceConfiguration {
    static var apiKey: String? {
        guard let url = Bundle.main.url(forResource: "LocalVoiceConfiguration", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let configuration = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String],
              let key = configuration["OpenAIAPIKey"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !key.isEmpty else { return nil }
        return key
    }
}
