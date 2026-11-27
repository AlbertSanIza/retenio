import Testing

@testable import retenio

struct ToolContinuationsTests {
    @Test func ordinaryToolWaitsForPendingRatingAcknowledgment() {
        var outputs = ToolContinuations()
        outputs.begin("rating")
        outputs.begin("next-card")
        let early = outputs.finish("next-card")
        let complete = outputs.finish("rating")
        let duplicate = outputs.finish("rating")
        #expect(!early)
        #expect(complete)
        #expect(!duplicate)
    }

    @Test func busyReplyAndPendingSaveCanFinishInEitherOrder() {
        for first in ["busy", "save"] {
            var outputs = ToolContinuations()
            outputs.begin("save")
            outputs.begin("busy")
            let early = outputs.finish(first)
            let complete = outputs.finish(first == "save" ? "busy" : "save")
            #expect(!early)
            #expect(complete)
        }
    }
}
