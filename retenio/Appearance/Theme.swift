import SwiftUI

/// Shared palette follows the selected appearance; action colors stay consistent.
enum RetenioTheme {
    static var backgroundTop: Color { AppSettings.shared.theme.backgroundTop }
    static var backgroundBottom: Color { AppSettings.shared.theme.backgroundBottom }
    static var accent: Color { AppSettings.shared.theme.accent }
    static let call = Color(red: 0.08, green: 0.60, blue: 0.32)
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

extension AppTheme {
    var backgroundTop: Color {
        switch self {
        case .evergreen: Color(red: 0.02, green: 0.34, blue: 0.29)
        case .midnight: Color(red: 0.07, green: 0.18, blue: 0.36)
        case .plum: Color(red: 0.29, green: 0.12, blue: 0.32)
        }
    }
    var backgroundBottom: Color {
        switch self {
        case .evergreen: Color(red: 0.01, green: 0.12, blue: 0.11)
        case .midnight: Color(red: 0.02, green: 0.05, blue: 0.13)
        case .plum: Color(red: 0.10, green: 0.03, blue: 0.13)
        }
    }
    var accent: Color {
        switch self {
        case .evergreen: Color(red: 0.55, green: 0.98, blue: 0.81)
        case .midnight: Color(red: 0.64, green: 0.81, blue: 1.00)
        case .plum: Color(red: 0.97, green: 0.72, blue: 0.89)
        }
    }
}
