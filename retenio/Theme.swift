import SwiftUI

/// Retenio's palette: deep evergreen surfaces and luminous mint highlights.
enum RetenioTheme {
    static let backgroundTop = Color(red: 0.02, green: 0.34, blue: 0.29)
    static let backgroundBottom = Color(red: 0.01, green: 0.12, blue: 0.11)
    static let accent = Color(red: 0.55, green: 0.98, blue: 0.81)
    static let call = Color(red: 0.12, green: 0.76, blue: 0.42)
    static let muted = Color(red: 0.65, green: 0.08, blue: 0.12)
    static let selectedControl = Color.white
    static let selectedControlOpacity = 0.5
    static let callTintStrength = 0.9
    static let waveformTintStrength = 0.7
    static let waveformGradientStrength = 1.0
    static let hangup = Color(red: 0.93, green: 0.18, blue: 0.27)
}

/// Shared typography keeps the idle and in-call identity consistent.
struct RetenioWordmark: View {
    var size: CGFloat = 72

    var body: some View {
        Text("Retenio")
            .font(.system(size: size, weight: .semibold, design: .rounded))
            .tracking(-size * 0.035)
            .foregroundStyle(.white)
            .accessibilityAddTraits(.isHeader)
    }
}

#Preview("Wordmark") {
    RetenioWordmark()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { CallBackground() }
}
