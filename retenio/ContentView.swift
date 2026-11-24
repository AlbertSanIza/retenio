import SwiftUI

struct ContentView: View {
    @State private var call = CallPresentation()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(phase: CallPresentation.Phase = .idle) {
        _call = State(initialValue: CallPresentation(phase: phase))
    }

    var body: some View {
        CallCanvas { geometry in
            let width = geometry.size.width
            let voiceY = geometry.size.height * 0.36
            let isConnected = call.phase == .connected
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
                    .opacity(isConnected ? 1 : 0)
                    .animation(.easeInOut(duration: 0.2), value: isConnected)
                    .accessibilityHidden(!isConnected)
                CallVisual(active: call.isActive, connected: isConnected, tint: .mint) {
                    HStack(spacing: 12) {
                        ForEach(0..<4) { _ in Capsule().fill(.mint).frame(width: 38, height: 38) }
                    }
                }
                .frame(width: 240, height: 140)
                .position(x: width / 2, y: voiceY)
                HStack(spacing: 28) {
                    CallControl(
                        symbol: call.isSpeaker ? "speaker.wave.2.fill" : "ear.fill", title: "Audio",
                        selected: call.isSpeaker,
                    ) {
                        call.isSpeaker.toggle()
                    }
                    .opacity(isConnected ? 1 : 0)
                    .allowsHitTesting(isConnected)
                    .accessibilityHidden(!isConnected)
                    CallToggleButton(active: call.isActive, disabled: false, action: call.toggleCall)
                        .accessibilityLabel(call.phase == .connecting ? "Cancel call" : (call.isActive ? "End call" : "Start call"))
                    CallControl(
                        symbol: call.isMuted ? "mic.slash.fill" : "mic.fill", title: "Mute", selected: call.isMuted,
                    ) {
                        call.isMuted.toggle()
                    }
                    .opacity(isConnected ? 1 : 0)
                    .allowsHitTesting(isConnected)
                    .accessibilityHidden(!isConnected)
                }
                .animation(.easeInOut(duration: 0.25), value: isConnected)
                .frame(height: 112)
                .position(x: width / 2, y: geometry.size.height - 64)
            }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview("Ready") { ContentView() }

#Preview("Connecting") { ContentView(phase: .connecting) }

#Preview("Connected") { ContentView(phase: .connected) }

#Preview("iPad landscape", traits: .fixedLayout(width: 1194, height: 834)) { ContentView() }

#Preview("Small iPad window", traits: .fixedLayout(width: 400, height: 360)) { ContentView() }

#Preview("iPad connecting", traits: .fixedLayout(width: 1194, height: 834)) { ContentView(phase: .connecting) }

#Preview("Small connected window", traits: .fixedLayout(width: 400, height: 360)) { ContentView(phase: .connected) }
