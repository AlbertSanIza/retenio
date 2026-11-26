import AVFoundation
import SwiftUI

/// Prepare microphone access without starting a call or activating the audio session.
struct MicrophonePermissionView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var permission = AVAudioApplication.shared.recordPermission
    @State private var requesting = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 48, weight: .medium))
                        .foregroundStyle(RetenioTheme.accent)
                        .frame(width: 112, height: 112)
                        .glassEffect(.regular, in: .circle)
                        .accessibilityHidden(true)
                    VStack(spacing: 12) {
                        Text(permission == .denied ? "Let’s turn your microphone on" : "Your voice starts here")
                            .font(.largeTitle.bold())
                            .accessibilityAddTraits(.isHeader)
                        Text(
                            permission == .denied
                                ? "Microphone access is off. Enable it in Settings so Retenio can hear you during a call."
                                : "Allow microphone access to talk with Retenio. We’ll get this ready before you start a call."
                        )
                        .font(.body)
                        .foregroundStyle(.secondary)
                    }
                    Button {
                        if permission == .denied {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        } else {
                            requesting = true
                        }
                    } label: {
                        Text(permission == .denied ? "Open Settings" : "Allow Microphone")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(RetenioTheme.accent)
                    .foregroundStyle(RetenioTheme.backgroundBottom)
                    .disabled(requesting)
                    .accessibilityIdentifier("microphone-permission-action")
                    Text("You control your microphone. Mute it at any time during a call.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)
                .padding(32)
                .frame(maxWidth: .infinity)
            }
            .background { CallBackground() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Not Now") { dismiss() }
                        .disabled(requesting)
                }
            }
            .task(id: requesting) {
                guard requesting else { return }
                _ = await AVAudioApplication.requestRecordPermission()
                requesting = false
                refreshPermission()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { refreshPermission() }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func refreshPermission() {
        permission = AVAudioApplication.shared.recordPermission
        if permission == .granted { dismiss() }
    }
}

#Preview("Microphone Permission — iPhone") {
    MicrophonePermissionView()
}
