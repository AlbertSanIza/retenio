import SwiftUI

struct CallVisualState: Equatable {
    var active: Bool
    var connected: Bool
}

extension EnvironmentValues {
    @Entry var callVisualState: CallVisualState? = nil
}

/// The waveform owns one continuous renderer for both connection and conversation.
struct CallVisual<Waveform: View>: View {
    let active: Bool
    let connected: Bool
    let tint: Color
    @ViewBuilder var waveform: () -> Waveform

    var body: some View {
        waveform()
            .environment(\.callVisualState, CallVisualState(active: active, connected: connected))
            .opacity(active ? 1 : 0)
            .animation(active ? .easeIn(duration: 0.25) : .easeOut(duration: 0.25), value: active)
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(connected ? "Voice Conversation" : "Connecting")
            .accessibilityHidden(!active)
    }
}

#Preview("Connection Morph") {
    @Previewable @State var active = false
    @Previewable @State var connected = false
    VStack(spacing: 48) {
        CallVisual(active: active, connected: connected, tint: .mint) {
            CallDots(active: connected, tint: .mint)
        }
        .frame(width: 240, height: 140)
        HStack {
            Button(active ? "End" : "Start") {
                active.toggle()
                connected = false
            }
            Button(connected ? "Reconnect" : "Connect") { connected.toggle() }
                .disabled(!active)
        }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}
