import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @Environment(\.dismiss) private var dismiss
    var library: LocalLibrary = .shared
    @State private var decks: [DeckSummary]?
    @State private var error: String?
    @State private var importing = false
    @State private var choosingFile = false
    @State private var importedCount: Int?

    var body: some View {
        NavigationStack {
            List {
                if importing { ProgressView("Importing Cards and Images…") }
                if let importedCount {
                    Text("Imported ^[\(importedCount) card](inflect: true). Existing review progress was preserved.")
                        .foregroundStyle(.secondary)
                }
                Button("Import Anki Deck", systemImage: "square.and.arrow.down") {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    choosingFile = true
                }.disabled(
                    importing)
                Text(
                    "Export an .apkg from Anki with Support older Anki versions enabled. Cards and reviews stay on this device."
                ).font(.caption).foregroundStyle(.secondary)
                if let error { Text(error).foregroundStyle(.red) }
                if decks == nil && error == nil { ProgressView("Loading Library") }
                if decks?.isEmpty == true && error == nil {
                    ContentUnavailableView(
                        "Your Library Is Empty", systemImage: "books.vertical",
                        description: Text("Your decks and progress will live on this device."), )
                }
                ForEach(decks ?? []) { deck in
                    LabeledContent(deck.name) { Text("^[\(deck.count) card](inflect: true)") }
                }
            }
            .navigationTitle("Library")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        dismiss()
                    }.disabled(importing)
                }
            }
            .interactiveDismissDisabled(importing)
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [UTType(filenameExtension: "apkg") ?? .data]) { result in
                switch result {
                case .success(let url):
                    guard !importing else { return }
                    importing = true
                    let scoped = url.startAccessingSecurityScopedResource()
                    Task { await importFile(url, scoped: scoped) }
                case .failure(let failure): error = failure.localizedDescription
                }
            }
            .task {
                do { try await reload() } catch { self.error = error.localizedDescription }
            }
        }
    }

    private func importFile(_ url: URL, scoped: Bool) async {
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        error = nil
        importedCount = nil
        defer { importing = false }
        do {
            let plan = try await Task.detached(priority: .userInitiated) { try AnkiImporter.read(url) }.value
            try await library.importDeck(plan)
            try await reload()
            importedCount = plan.cards.count
        } catch { self.error = error.localizedDescription }
    }

    private func reload() async throws {
        decks = try await library.decks()
    }
}

#Preview("Library") {
    LibraryView(library: LocalLibrary(directory: URL.temporaryDirectory.appendingPathComponent("RetenioLibraryPreview")))
}
