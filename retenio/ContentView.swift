import SwiftUI

struct ContentView: View {
    @State private var call = CallPresentation()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        CallCanvas { geometry in
            let width = geometry.size.width
            let voiceY = geometry.size.height * 0.36
            ZStack {
                Text("Retenio")
                    .font(.system(size: 72, weight: .semibold, design: .rounded))
                    .tracking(-2.5)
                    .foregroundStyle(.white)
                    .scaleEffect(call.isActive ? 2.0 / 3 : 1)
                    .position(x: width / 2, y: call.isActive ? 58 : voiceY)
                    .animation(reduceMotion ? nil : .smooth(duration: 0.55), value: call.isActive)
                Text("00:00")
                    .monospacedDigit()
                    .foregroundStyle(.mint)
                    .position(x: width / 2, y: 112)
                    .opacity(call.isActive ? 1 : 0)
                    .animation(.easeInOut(duration: 0.2), value: call.isActive)
                    .accessibilityHidden(!call.isActive)
                HStack(spacing: 12) {
                    ForEach(0..<4) { _ in Capsule().fill(.mint).frame(width: 32, height: 38) }
                }
                .frame(width: 240, height: 140)
                .scaleEffect(reduceMotion || call.isActive ? 1 : 0.85)
                .position(x: width / 2, y: voiceY)
                .opacity(call.isActive ? 1 : 0)
                .animation(
                    .easeInOut(duration: reduceMotion ? 0.15 : 0.35)
                        .delay(call.isActive && !reduceMotion ? 0.12 : 0),
                    value: call.isActive,
                )
                .accessibilityHidden(true)
                HStack(spacing: 28) {
                    CallControl(
                        symbol: call.isSpeaker ? "speaker.wave.2.fill" : "ear.fill", title: "Audio",
                        selected: call.isSpeaker,
                    ) {
                        call.isSpeaker.toggle()
                    }
                    .opacity(call.isActive ? 1 : 0)
                    .allowsHitTesting(call.isActive)
                    .accessibilityHidden(!call.isActive)
                    CallToggleButton(active: call.isActive, disabled: false, action: call.toggleCall)
                    CallControl(
                        symbol: call.isMuted ? "mic.slash.fill" : "mic.fill", title: "Mute", selected: call.isMuted,
                    ) {
                        call.isMuted.toggle()
                    }
                    .opacity(call.isActive ? 1 : 0)
                    .allowsHitTesting(call.isActive)
                    .accessibilityHidden(!call.isActive)
                }
                .animation(.easeInOut(duration: 0.25), value: call.isActive)
                .frame(height: 112)
                .position(x: width / 2, y: geometry.size.height - 64)
            }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview("Ready") { ContentView() }

#Preview("iPad landscape", traits: .fixedLayout(width: 1194, height: 834)) { ContentView() }

#Preview("Small iPad window", traits: .fixedLayout(width: 400, height: 360)) { ContentView() }
