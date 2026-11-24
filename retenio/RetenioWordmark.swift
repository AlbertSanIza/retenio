import SwiftUI

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
