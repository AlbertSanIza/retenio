import SwiftUI

struct ContentView: View {
    @State private var call = CallPresentation()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(phase: CallPresentation.Phase = .idle) {
        _call = State(initialValue: CallPresentation(phase: phase))
    }

    var body: some View {
        let isConnected = call.phase == .connected
        CallCanvas { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let headerHeight = min(128, height * 0.4)
            let visualHeight = min(140, max(0, height - headerHeight))
            let voiceY = min(height - visualHeight / 2, max(headerHeight + visualHeight / 2, height * 0.43))
            let titleScale = min(1, min(width / 340, headerHeight / 128))
            ZStack {
                Text("Retenio")
                    .font(.system(size: 72, weight: .semibold, design: .rounded))
                    .tracking(-2.5)
                    .foregroundStyle(.white)
                    .scaleEffect(titleScale * (call.isActive ? 2.0 / 3 : 1))
                    .position(x: width / 2, y: call.isActive ? headerHeight * 0.45 : voiceY)
                    .animation(reduceMotion ? nil : .smooth(duration: 0.55), value: call.isActive)
                Text("00:00")
                    .monospacedDigit()
                    .foregroundStyle(.mint)
                    .position(x: width / 2, y: headerHeight * 0.85)
                    .opacity(isConnected ? 1 : 0)
                    .animation(.easeInOut(duration: 0.2), value: isConnected)
                    .accessibilityHidden(!isConnected)
                CallVisual(active: call.isActive, connected: isConnected, tint: .mint) {
                    CallDots(active: isConnected, tint: .mint)
                }
                .frame(width: 240, height: 140)
                .scaleEffect(min(width / 280, visualHeight / 140))
                .position(x: width / 2, y: voiceY)
            }
        } controls: {
            HStack(spacing: 0) {
                CallControl(
                    symbol: call.isSpeaker ? "speaker.wave.2.fill" : "ear.fill", title: "Audio",
                    selected: call.isSpeaker,
                ) {
                    call.isSpeaker.toggle()
                }
                .opacity(isConnected ? 1 : 0)
                .allowsHitTesting(isConnected)
                .accessibilityHidden(!isConnected)
                Spacer(minLength: 8)
                CallToggleButton(active: call.isActive, disabled: false, action: call.toggleCall)
                    .accessibilityLabel(call.phase == .connecting ? "Cancel call" : (call.isActive ? "End call" : "Start call"))
                Spacer(minLength: 8)
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
        }
        .preferredColorScheme(.dark)
    }
}

#Preview("Ready") { ContentView() }

#Preview("Connecting") { ContentView(phase: .connecting) }

#Preview("Connected") { ContentView(phase: .connected) }

#Preview("iPad Landscape", traits: .fixedLayout(width: 1194, height: 834)) { ContentView() }

#Preview("Small iPad Window", traits: .fixedLayout(width: 400, height: 360)) { ContentView() }

#Preview("iPad Connecting", traits: .fixedLayout(width: 1194, height: 834)) { ContentView(phase: .connecting) }

#Preview("Small Connected Window", traits: .fixedLayout(width: 400, height: 360)) { ContentView(phase: .connected) }
