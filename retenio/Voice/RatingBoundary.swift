import Foundation

/// Uses the server timeline shared by transcript timestamps, never the microphone clock.
nonisolated struct RatingBoundary {
    let eventID = UUID().uuidString

    var event: [String: Any] {
        [
            "type": "session.instructions.append", "event_id": eventID, "delegation_id": NSNull(),
            "content":
                "A rating prompt is starting. Only a new explicit spoken rating after this point can authorize saving a review. Wait for the backend to ask for the choice.",
        ]
    }

    func cutoff(from event: [String: Any]) -> Double? {
        guard event["type"] as? String == "session.instructions.appended",
            event["client_event_id"] as? String == eventID,
            let end = (event["end_ms"] as? NSNumber)?.doubleValue, end.isFinite, end >= 0
        else { return nil }
        return end
    }
}
