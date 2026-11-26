import SwiftUI

/// Occupies the call button's height until microphone access is ready.
struct MicrophonePermissionButton: View {
    var denied = false
    var disabled = false
    var action: () -> Void
    @Environment(\.controlSize) private var controlSize

    var body: some View {
        Button(action: action) {
            Text(denied ? "Open Microphone Settings" : "Allow Microphone")
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 20)
        }
        .buttonStyle(.glass(.clear))
        .buttonBorderShape(.capsule)
        .frame(height: controlSize == .small ? 64 : 90)
        .disabled(disabled)
        .accessibilityHint(denied ? "Enable microphone access in Settings before starting a call." : "Allow Retenio to hear you during calls.")
        .accessibilityIdentifier("microphone-permission-action")
    }
}

#Preview("Microphone Permission — iPhone") {
    MicrophonePermissionButton {}
        .frame(width: 282)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { CallBackground() }
}
