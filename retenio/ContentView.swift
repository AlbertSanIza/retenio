import SwiftUI

struct ContentView: View {
    @State private var call = CallPresentation()

    var body: some View {
        CallCanvas { geometry in
            let width = geometry.size.width
            let voiceY = geometry.size.height * 0.36
            ZStack {
                Text("Retenio")
                    .font(.system(size: call.isActive ? 48 : 72, weight: .semibold, design: .rounded))
                    .tracking(-2.5)
                    .foregroundStyle(.white)
                    .position(x: width / 2, y: call.isActive ? 58 : voiceY)
                if call.isActive {
                    Text("00:00")
                        .monospacedDigit()
                        .foregroundStyle(.mint)
                        .position(x: width / 2, y: 112)
                    HStack(spacing: 12) {
                        ForEach(0..<4) { _ in Capsule().fill(.mint).frame(width: 32, height: 38) }
                    }
                    .frame(width: 240, height: 140)
                    .position(x: width / 2, y: voiceY)
                    .accessibilityHidden(true)
                }
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
