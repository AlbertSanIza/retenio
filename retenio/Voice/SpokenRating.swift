import Foundation

/// A card-bound rating prompt must precede an explicit choice in the input transcript.
nonisolated struct SpokenRating {
    private var afterMS: Double?
    private var transcript: String? = ""
    private var lastEndMS: Double?
    private var lastDeltaAt: Date?
    private(set) var choice: ReviewRating?

    mutating func request(after inputMS: Double) {
        afterMS = inputMS
        transcript = ""
        lastEndMS = nil
        choice = nil
        lastDeltaAt = nil
    }

    mutating func receive(_ event: [String: Any], at now: Date = .now) {
        guard let cutoff = afterMS, let start = (event["start_ms"] as? NSNumber)?.doubleValue,
            let end = (event["end_ms"] as? NSNumber)?.doubleValue,
            start.isFinite, end.isFinite, start >= cutoff, end >= start,
            end >= (lastEndMS ?? end), let delta = event["delta"] as? String, !delta.isEmpty
        else { return }
        if let lastEndMS, start - lastEndMS > 1600 { transcript = "" }
        if let transcript, transcript.count + delta.count <= 320 {
            self.transcript = transcript + delta
        } else {
            // Reject the whole utterance instead of interpreting its tail as a rating.
            transcript = nil
        }
        lastEndMS = end
        lastDeltaAt = now
        guard let transcript else {
            choice = nil
            return
        }
        let normalized = transcript.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }.joined(separator: " ")
        choice = ReviewRating.allCases.first { rating in
            let word = rating.rawValue
            return [word, "\(word) please", "rate it \(word)", "mark it \(word)", "mark it as \(word)"].contains(
                normalized)
        }
    }
    func confirmedChoice(at now: Date = .now) -> ReviewRating? {
        guard let lastDeltaAt, now.timeIntervalSince(lastDeltaAt) >= 1.2 else { return nil }
        return choice
    }

}
