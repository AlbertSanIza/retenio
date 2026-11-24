import SwiftUI

/// One anchored visual, from a breathing connection blob to the live waveform.
struct CallVisual<Waveform: View>: View {
    let active: Bool
    let connected: Bool
    let tint: Color
    @ViewBuilder var waveform: () -> Waveform
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let handoff = Animation.easeInOut(duration: 0.2)
            .delay(connected && !reduceMotion ? 0.65 : 0)
        ZStack {
            TimelineView(.animation(paused: !active || connected || reduceMotion || scenePhase != .active)) { timeline in
                ConnectionBlob(
                    separation: connected && !reduceMotion ? 1 : 0,
                    time: reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate,
                    tint: tint,
                )
                .animation(reduceMotion ? nil : .smooth(duration: 0.8), value: connected)
            }
            .opacity(connected ? 0 : 1)
            .animation(handoff, value: connected)
            waveform()
                .opacity(connected ? 1 : 0)
                .animation(handoff, value: connected)
        }
        .opacity(active ? 1 : 0)
        .animation(.easeInOut(duration: 0.2), value: active)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(connected ? "Voice conversation" : "Connecting")
        .accessibilityHidden(!active)
    }
}

private struct ConnectionBlob: View, Animatable {
    var separation: Double
    let time: TimeInterval
    let tint: Color

    var animatableData: Double {
        get { separation }
        set { separation = newValue }
    }

    var body: some View {
        Canvas { context, size in
            let progress = min(1, max(0, separation))
            let softness = 1 - progress
            // Blurring then thresholding joins the overlapping shapes into a liquid silhouette.
            context.addFilter(.alphaThreshold(min: 0.5, color: tint))
            context.addFilter(.blur(radius: 8 * softness))
            context.drawLayer { layer in
                for index in 0..<4 {
                    let offset = Double(index) - 1.5
                    let phase = time * 1.6 + Double(index) * 1.4
                    let width = 38 + softness * (38 + sin(phase) * 4)
                    let height = 38 + softness * (42 + cos(phase * 0.8) * 6)
                    let x = size.width / 2 + offset * (6 + 44 * progress)
                    let y = size.height / 2 + sin(phase) * 5 * softness
                    let rect = CGRect(x: x - width / 2, y: y - height / 2, width: width, height: height)
                    layer.fill(Path(roundedRect: rect, cornerRadius: width / 2), with: .color(.white))
                }
            }
        }
    }
}

#Preview("Connection morph") {
    @Previewable @State var connected = false
    VStack(spacing: 48) {
        CallVisual(active: true, connected: connected, tint: .mint) {
            HStack(spacing: 12) {
                ForEach(0..<4) { _ in Capsule().fill(.mint).frame(width: 38, height: 38) }
            }
        }
        .frame(width: 240, height: 140)
        Button(connected ? "Reconnect" : "Connect") { connected.toggle() }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}
