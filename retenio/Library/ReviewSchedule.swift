import Foundation

nonisolated enum ReviewRating: String, Codable, CaseIterable, Sendable {
    case again, hard, good, easy
}

/// A small, explicit Retenio scheduler. This is not Anki/FSRS synchronization.
nonisolated struct ReviewSchedule: Sendable {
    let interval: TimeInterval
    let repetitions: Int
    let due: Date

    static func next(rating: ReviewRating, interval: TimeInterval, repetitions: Int, now: Date) -> ReviewSchedule {
        let day: TimeInterval = 86400
        let next: TimeInterval
        switch rating {
        case .again: next = 10 * 60
        case .hard: next = max(day, interval * 1.2)
        case .good: next = max(3 * day, interval * 2)
        case .easy: next = max(7 * day, interval * 3)
        }
        let bounded = min(next, 365 * day)
        return ReviewSchedule(
            interval: bounded, repetitions: rating == .again ? 0 : repetitions + 1, due: now.addingTimeInterval(bounded),
        )
    }
}
