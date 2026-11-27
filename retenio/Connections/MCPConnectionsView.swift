import SwiftUI

struct MCPConnectionsView: View {
    @Bindable var settings = AppSettings.shared
    @State private var editing: RemoteMCPConnection?

    var body: some View {
        List {
            Section {
                ForEach(settings.mcpConnections) { connection in
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        editing = connection
                    } label: {
                        LabeledContent(connection.name, value: connection.enabled ? "Enabled" : "Disabled")
                    }
                }
                .onDelete { settings.mcpConnections.remove(atOffsets: $0) }
                Button("Add connection", systemImage: "plus") {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    editing = RemoteMCPConnection()
                }
                .disabled(settings.mcpConnections.count >= 8)
            } footer: {
                Text(
                    "Connect public MCP servers that do not require sign-in. Only the tools you list are available. Changes apply to new calls."
                )
            }
        }
        .navigationTitle("MCP connections")
        .sheet(item: $editing) { connection in
            MCPConnectionEditor(connection: connection) { saved in
                if let index = settings.mcpConnections.firstIndex(where: { $0.id == saved.id }) {
                    settings.mcpConnections[index] = saved
                } else if settings.mcpConnections.count < 8 {
                    settings.mcpConnections.append(saved)
                }
            }
        }
    }
}

private struct MCPConnectionEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var connection: RemoteMCPConnection
    @State private var toolNames: String
    let save: (RemoteMCPConnection) -> Void

    init(connection: RemoteMCPConnection, save: @escaping (RemoteMCPConnection) -> Void) {
        _connection = State(initialValue: connection)
        _toolNames = State(initialValue: connection.allowedTools.joined(separator: ", "))
        self.save = save
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Name", text: $connection.name)
                    TextField("https://example.com/mcp", text: $connection.serverURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                }
                Section {
                    TextField(
                        "Tool names, separated by commas",
                        text: $toolNames, axis: .vertical,
                    )
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityLabel("Allowed tools")
                    .accessibilityIdentifier("mcp-tools")
                    Toggle("Allow these tools during calls", isOn: $connection.enabled)
                } header: {
                    Text("Allowed tools")
                } footer: {
                    Text(
                        "Enabling this connection allows the AI to send relevant conversation content to this server and run these tools without asking again during a call. Include only tools you trust to run hands-free. Leave it disabled to keep the connection without granting access."
                    )
                }
                if let message = connection.validationMessage {
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
            }
            .onChange(of: connection.serverURL) { _, _ in connection.enabled = false }
            .onChange(of: toolNames) { _, value in
                connection.allowedTools = value.split(separator: ",", omittingEmptySubsequences: false).map {
                    $0.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                connection.enabled = false
            }
            .navigationTitle("MCP connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        save(connection)
                        dismiss()
                    }.disabled(connection.validationMessage != nil)
                }
            }
            .preferredColorScheme(.dark)
            .tint(RetenioTheme.accent)
        }
    }
}
