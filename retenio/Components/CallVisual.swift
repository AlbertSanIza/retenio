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
            .animation(.easeInOut(duration: 0.2), value: active)
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(connected ? "Voice conversation" : "Connecting")
            .accessibilityHidden(!active)
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
