import SwiftUI

struct SettingsView: View {
    @Bindable var settings = AppSettings.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var preview = LiveCall()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Conversation voice", selection: $settings.voice) {
                        ForEach(ConversationVoice.allCases) { voice in Text(voice.title).tag(voice) }
                    }
                    .disabled(preview.isPresentingCall)
                    Button(preview.isPresentingCall ? "Stop preview" : "Preview voice", systemImage: "speaker.wave.2") {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        if preview.isPresentingCall { preview.end() } else { preview.start(preview: true) }
                    }
                    .buttonStyle(.glass)
                    .disabled(preview.phase == .ending)
                    if let error = preview.errorMessage { Text(error).foregroundStyle(.red) }
                } header: {
                    Text("Voice")
                } footer: {
                    Text(
                        "Your choice applies to new calls. Preview plays a short live greeting without using your microphone and uses your API balance."
                    )
                }
            }
            .navigationTitle("Settings")
            .preferredColorScheme(.dark)
            .tint(RetenioTheme.accent)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        dismiss()
                    }.disabled(preview.isPresentingCall)
                }
            }
            .interactiveDismissDisabled(preview.isPresentingCall)
            .task(id: preview.phase) {
                await preview.endPreviewAfterPlayback()
            }
            .onChange(of: scenePhase) { _, phase in if phase == .background { preview.end() } }
            .onDisappear { preview.end() }
        }
    }

}
