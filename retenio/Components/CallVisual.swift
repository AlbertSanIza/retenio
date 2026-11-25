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
            let gradient = Gradient(stops: [
                .init(color: .white.opacity(0.95), location: 0),
                .init(color: tint, location: 0.55),
                .init(color: tint.mix(with: .black, by: 0.24), location: 1),
            ])
            let shapes = (0..<4).map { index in
                let offset = Double(index) - 1.5
                let phase = time * 1.6 + Double(index) * 1.4
                let dotPhase = time * 1.5 + Double(index) * 0.82
                let width = 38 + softness * (38 + sin(phase) * 4)
                let height = 38 + softness * (42 + cos(phase * 0.8) * 6) + progress * (sin(dotPhase) + 1) * 3
                let x = size.width / 2 + offset * (6 + 44 * progress)
                let y = size.height / 2 + sin(phase) * 5 * softness + sin(dotPhase) * 2 * progress
                return CGRect(x: x - width / 2, y: y - height / 2, width: width, height: height)
            }
            // Keep the liquid silhouette separate from its lighting so the filter does not flatten the color.
            context.clipToLayer { mask in
                mask.addFilter(.alphaThreshold(min: 0.5, color: .white))
                mask.addFilter(.blur(radius: 8 * softness))
                mask.drawLayer { layer in
                    for rect in shapes {
                        layer.fill(Path(roundedRect: rect, cornerRadius: rect.width / 2), with: .color(.white))
                    }
                }
            }
            let bounds = shapes.reduce(CGRect.null) { $0.union($1) }
            context.fill(
                Path(CGRect(origin: .zero, size: size)),
                with: .linearGradient(gradient, startPoint: bounds.origin, endPoint: CGPoint(x: bounds.maxX, y: bounds.maxY)),
            )
            // As the blob separates, each dot gradually gets its own highlight and shaded underside.
            context.opacity = progress
            for rect in shapes {
                let path = Path(roundedRect: rect, cornerRadius: rect.width / 2)
                context.fill(
                    path,
                    with: .linearGradient(gradient, startPoint: rect.origin, endPoint: CGPoint(x: rect.maxX, y: rect.maxY)),
                )
                context.stroke(path, with: .color(.white.opacity(0.16)), lineWidth: 0.5)
            }
        }
    }
}

#Preview("Connection Morph") {
    @Previewable @State var connected = false
    VStack(spacing: 48) {
        CallVisual(active: true, connected: connected, tint: .mint) {
            CallDots(active: connected, tint: .mint)
        }
        .frame(width: 240, height: 140)
        Button(connected ? "Reconnect" : "Connect") { connected.toggle() }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}

#Preview("Blob Shape") {
    @Previewable @State var separation = 0.0
    VStack(spacing: 32) {
        ConnectionBlob(separation: separation, time: 0, tint: .mint)
            .frame(width: 240, height: 140)
        Slider(value: $separation, in: 0...1) {
            Text("Separation")
        }
        .frame(width: 240)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}
