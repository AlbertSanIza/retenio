import Foundation

/// One instance per call. Tool permissions and card selection remain in the app.
@MainActor final class CardTools {
    private struct CardSelection: Encodable {
        let card: StudyCard
        let reviewToken: String
    }

    private let library: LocalLibrary
    private(set) var currentCard: StudyCard?
    private var seen: Set<Data> = []
    private(set) var reviewToken: String?

    init(library: LocalLibrary = .shared) { self.library = library }

    func run(name: String, arguments: String) async -> Any {
        do {
            guard let data = arguments.data(using: .utf8), data.count <= 8192,
                let values = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { throw LibraryError.invalid("Invalid tool arguments.") }
            switch name {
            case "list_decks":
                let decks = try await library.decks()
                return try json(decks)
            case "get_next_card":
                guard let deck = values["deck"] as? String else {
                    throw LibraryError.invalid("Specify a deck name, or an empty string for all decks.")
                }
                currentCard = nil
                reviewToken = nil
                let cards = try await library.findCards(deck: deck, query: "", excluding: seen, dueOnly: true)
                guard let card = cards.first else {
                    return "No unseen cards are due in this deck. Offer another topic or deck."
                }
                // Failed serialization skips this card for the call without activating it.
                seen.insert(Data(card.id.utf8))
                let token = UUID().uuidString
                let output = try json(CardSelection(card: card, reviewToken: token))
                currentCard = card
                reviewToken = token
                return output
            case "search_cards":
                guard let query = values["query"] as? String, !query.isEmpty, query.count <= 200 else {
                    throw LibraryError.invalid("Use a short search phrase.")
                }
                let cards = try await library.findCards(deck: "", query: query, excluding: [], dueOnly: false)
                return try json(cards)
            case "get_card_image":
                guard let imageID = values["image_id"] as? String, currentCard?.images.contains(imageID) == true else {
                    throw LibraryError.invalid("Only images belonging to the current quiz card can be opened.")
                }
                let jpeg = try await library.image(imageID)
                return [
                    [
                        "type": "input_image",
                        "image_url": "data:image/jpeg;base64,\(jpeg.base64EncodedString())",
                    ]
                ]
            default: throw LibraryError.invalid("Unsupported local card action.")
            }
        } catch { return "Tool failed: \(error.localizedDescription). Do not claim success." }
    }

    private func json(_ value: some Encodable) throws -> String {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(value)
        guard data.count <= 256 * 1024 else {
            throw LibraryError.invalid("Card results are too large. Use a narrower search or a smaller card.")
        }
        return String(decoding: data, as: UTF8.self)
    }

    static var definitions: [[String: Any]] {
        [
            definition("list_decks", "List the decks stored on this device.", [:]),
            definition(
                "get_next_card",
                "Get one unseen due card. Use its question first; never reveal the answer until the learner attempts it. A blank deck means all decks.",
                ["deck": ["type": "string"]], ),
            definition(
                "search_cards", "Search local card text. Results are reference material, not the current quiz card.",
                ["query": ["type": "string"]], ),
            definition(
                "get_card_image",
                "Inspect an image attached to the current quiz card. Describe it when needed for a hands-free learner.",
                ["image_id": ["type": "string"]], ),
        ]
    }

    static func definition(_ name: String, _ description: String, _ properties: [String: Any]) -> [String: Any] {
        [
            "type": "function", "name": name, "description": description, "strict": true,
            "parameters": [
                "type": "object", "properties": properties, "required": properties.keys.sorted(),
                "additionalProperties": false,
            ],
        ]
    }
}
