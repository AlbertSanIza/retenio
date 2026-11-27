import SwiftUI

struct LibraryView: View {
    @Environment(\.dismiss) private var dismiss
    var library: LocalLibrary = .shared
    @State private var decks: [DeckSummary]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
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
                    }
                }
            }
            .task { await reload() }
        }
    }

    private func reload() async {
        do {
            decks = try await library.decks()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

#Preview("Library") {
    LibraryView(library: LocalLibrary(directory: URL.temporaryDirectory.appendingPathComponent("RetenioLibraryPreview")))
}
