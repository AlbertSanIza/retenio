import Foundation
import Testing

@testable import retenio

struct ReviewScheduleTests {
    @Test(arguments: [(ReviewRating.again, 600.0), (.hard, 86400.0), (.good, 259200.0), (.easy, 604800.0)])
    func firstReview(rating: ReviewRating, expected: TimeInterval) {
        let now = Date(timeIntervalSince1970: 1000)
        let result = ReviewSchedule.next(rating: rating, interval: 0, repetitions: 0, now: now)
        #expect(result.interval == expected)
        #expect(result.due == now.addingTimeInterval(expected))
        #expect(result.repetitions == (rating == .again ? 0 : 1))
    }

    @Test func capsLongIntervalsAndResetsAgain() {
        let now = Date(timeIntervalSince1970: 1000)
        #expect(
            ReviewSchedule.next(rating: .easy, interval: 86400 * 300, repetitions: 20, now: now).interval == 86400 * 365
        )
        let again = ReviewSchedule.next(rating: .again, interval: 86400 * 300, repetitions: 20, now: now)
        #expect(again.repetitions == 0)
        #expect(again.interval == 600)
    }
}
