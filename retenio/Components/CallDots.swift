import SwiftUI

/// Quiet motion and soft lighting keep the connected visual alive between turns.
struct CallDots: View {
    let active: Bool
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TimelineView(.animation(paused: !active || reduceMotion || scenePhase != .active)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 12) {
                ForEach(0..<4) { index in
                    let phase = time * 1.5 + Double(index) * 0.82
                    let breath = reduceMotion ? 0 : (sin(phase) + 1) * 3
                    Capsule()
                        .fill(
                            LinearGradient(
                                stops: [
                                    .init(color: .white.opacity(0.95), location: 0),
                                    .init(color: tint, location: 0.55),
                                    .init(color: tint.mix(with: .black, by: 0.24), location: 1),
                                ],
                                startPoint: .topLeading, endPoint: .bottomTrailing,
                            )
                        )
                        .overlay(Capsule().strokeBorder(.white.opacity(0.16), lineWidth: 0.5))
                        .frame(width: 38, height: 38 + breath)
                        .offset(y: reduceMotion ? 0 : sin(phase) * 2)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

#Preview("Quiet Call") {
    CallDots(active: true, tint: .mint)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { CallBackground() }
}
