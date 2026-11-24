import Foundation

/// Each request belongs to one call. A short grace period allows an interruption;
/// the deadline prevents silence or a stalled farewell from leaving a paid call open.
struct VoiceHangup {
    let requestedAt: Date
    let inputEndMS: Double

    func shouldEnd(at now: Date, farewellFinished: Bool) -> Bool {
        let elapsed = now.timeIntervalSince(requestedAt)
        return elapsed >= 6 || (elapsed >= 1 && farewellFinished)
    }

    func isNewSpeech(_ event: [String: Any]) -> Bool {
        guard let start = (event["start_ms"] as? NSNumber)?.doubleValue,
              let delta = event["delta"] as? String,
              delta.unicodeScalars.contains(where: CharacterSet.letters.contains) else { return false }
        return start >= inputEndMS + 300
    }
}
