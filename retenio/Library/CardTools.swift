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
    private var savedReviews: [String: (cardID: String, rating: ReviewRating, result: String)] = [:]
    var ratingBoundaryMS: Double?
    private var spokenRating = SpokenRating()
    private(set) var reviewToken: String?

    init(library: LocalLibrary = .shared) { self.library = library }

    func receiveTranscript(_ event: [String: Any], at now: Date = .now) { spokenRating.receive(event, at: now) }

    func run(name: String, arguments: String, now: Date = .now) async -> Any {
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
                spokenRating = SpokenRating()
                ratingBoundaryMS = nil
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
            case "request_rating":
                guard let card = currentCard else { throw LibraryError.invalid("Fetch a question first.") }
                guard let cutoff = ratingBoundaryMS, cutoff.isFinite, cutoff >= 0 else {
                    throw LibraryError.invalid("The rating prompt is not synchronized. Try asking for a rating again.")
                }
                ratingBoundaryMS = nil
                spokenRating.request(after: cutoff)
                reviewToken = UUID().uuidString
                return try json([
                    "card_id": card.id, "review_token": reviewToken!,
                    "instruction":
                        "Ask the learner to say Again, Hard, Good, or Easy. Wait for their fresh spoken choice before calling rate_card.",
                ])
            case "rate_card":
                guard let cardID = values["card_id"] as? String,
                    let raw = values["rating"] as? String, let rating = ReviewRating(rawValue: raw),
                    let token = values["review_token"] as? String
                else { throw LibraryError.invalid("A card, rating, and review token are required.") }
                if let saved = savedReviews[token] {
                    guard Data(saved.cardID.utf8) == Data(cardID.utf8), saved.rating == rating else {
                        throw LibraryError.invalid("This review has already been saved with a different choice.")
                    }
                    return saved.result
                }
                guard let currentCard, Data(currentCard.id.utf8) == Data(cardID.utf8), reviewToken == token else {
                    throw LibraryError.invalid("The card or rating token changed. Request a fresh rating for the current card; do not skip it.")
                }
                let deadline = ContinuousClock.now.advanced(by: .seconds(5))
                var ratingTime = now
                while spokenRating.confirmedChoice(at: ratingTime) == nil, reviewToken == token,
                    ContinuousClock.now < deadline
                {
                    try await Task.sleep(for: .milliseconds(100))
                    ratingTime = .now
                }
                // A choice received near the deadline still gets its full quiet period.
                if reviewToken == token, spokenRating.choice == rating,
                    spokenRating.confirmedChoice(at: ratingTime) == nil
                {
                    try await Task.sleep(for: .milliseconds(1200))
                    ratingTime = .now
                }
                try Task.checkCancellation()
                guard reviewToken == token, spokenRating.confirmedChoice(at: ratingTime) == rating else {
                    throw LibraryError.invalid(
                        "No matching spoken choice was heard after the rating prompt. Ask the learner to say Again, Hard, Good, or Easy; never infer it."
                    )
                }
                let due = try await library.rate(cardID: cardID, rating: rating, reviewID: token)
                let result = try json(["status": "saved", "rating": rating.rawValue, "next_due": due.ISO8601Format()])
                savedReviews[token] = (cardID, rating, result)
                if reviewToken == token {
                    self.currentCard = nil
                    reviewToken = nil
                    spokenRating = SpokenRating()
                }
                return result
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
            definition(
                "request_rating",
                "Prepare to ask for a rating of the current card after discussing the answer. Call this before asking the learner to say Again, Hard, Good, or Easy. Use the returned fresh review token when saving their spoken choice.",
                [:], ),
            definition(
                "rate_card",
                "Save only the learner's explicit Again/Hard/Good/Easy choice for the current quiz card. Never infer a rating from answer quality or casual agreement. Use its review token; repeated calls are idempotent.",
                [
                    "card_id": ["type": "string"], "review_token": ["type": "string"],
                    "rating": ["type": "string", "enum": ["again", "hard", "good", "easy"]],
                ], ),
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
