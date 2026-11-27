import SwiftUI

struct AISettingsView: View {
    @Bindable var settings = AppSettings.shared

    var body: some View {
        Form {
            Section {
                Picker("Backend model", selection: $settings.ai.model) {
                    ForEach(BackendModel.allCases) { model in Text(model.title).tag(model) }
                }
                Picker("Reasoning effort", selection: $settings.ai.reasoning) {
                    ForEach(ReasoningEffort.allCases) { effort in Text(effort.title).tag(effort) }
                }
            } header: {
                Text("Thinking")
            } footer: {
                Text(
                    "GPT-Live 1.1 handles the voice. This model handles questions and tools. Higher effort may take longer and cost more. Model access depends on your OpenAI project."
                )
            }
            Section {
                Toggle("Search the web", isOn: $settings.ai.webSearch)
                Toggle("Read local cards", isOn: $settings.ai.readCards)
                Toggle("View card images", isOn: $settings.ai.viewImages).disabled(!settings.ai.readCards)
                Toggle("Save review ratings", isOn: $settings.ai.saveRatings).disabled(!settings.ai.readCards)
                Toggle("Hang up when I say goodbye", isOn: $settings.ai.endCall)
            } header: {
                Text("Permissions")
            } footer: {
                Text(
                    "Card text and images used during a call are sent to OpenAI. Ratings still require your spoken choice. Changes apply to the next call."
                )
            }
        }
        .navigationTitle("AI & permissions")
        .navigationBarTitleDisplayMode(.inline)
        .tint(settings.theme.accent)
    }
}
