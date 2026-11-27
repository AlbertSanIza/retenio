import Foundation
import Testing

@testable import retenio

struct CallActivityTests {
    @Test func silenceIsWaitingAndAudiblePlaybackTakesPriority() {
        var activity = CallActivity()
        let start = Date(timeIntervalSince1970: 100)
        activity.receive(["type": "session.input_transcript.delta", "delta": "Why?", "start_ms": 0, "end_ms": 100], now: start)
        #expect(activity.status(at: start.addingTimeInterval(2)) == .waiting)
        #expect(activity.status(at: start.addingTimeInterval(11)) == .delayed)
        activity.lastAudible = start.addingTimeInterval(11)
        #expect(activity.status(at: start.addingTimeInterval(11.2)) == .speaking)
    }

    @Test func completedWorkReturnsToListeningAndPreservesSources() {
        var activity = CallActivity()
        let start = Date(timeIntervalSince1970: 100)
        activity.receive(["type": "session.delegation.created", "delegation": ["id": "one"]], now: start)
        #expect(activity.status(at: start) == .thinking)
        activity.receive(
            [
                "type": "response.event", "delegation_id": "one",
                "event": [
                    "type": "response.output_text.annotation.added",
                    "annotation": [
                        "type": "url_citation", "title": "Source", "url": "https://example.com",
                    ],
                ],
            ], now: start, )
        activity.receive(["type": "response.event", "delegation_id": "one", "event": ["type": "response.completed"]], now: start)
        #expect(activity.status(at: start) == .listening)
        #expect(activity.sources.first?.title == "Source")
    }

    @Test func completedMCPErrorPreservesConnectionNotice() {
        var activity = CallActivity()
        let now = Date(timeIntervalSince1970: 100)
        activity.receive(
            [
                "type": "response.event",
                "event": ["type": "response.mcp_call.failed"],
            ], now: now, )
        let notice = activity.notice
        activity.receive(
            [
                "type": "response.event",
                "event": [
                    "type": "response.output_item.done",
                    "item": ["type": "mcp_call", "name": "search", "error": "unavailable"],
                ],
            ], now: now, )
        #expect(activity.notice == notice)
        #expect(activity.notice?.contains("MCP connection") == true)
    }

    @Test func sustainedAudioOutlastsTheGracePeriod() {
        let now = Date(timeIntervalSince1970: 100)
        var activity = CallActivity()
        activity.work["search"] = .init(status: .searching, started: now)
        activity.isAudible = true
        #expect(activity.status(at: now.addingTimeInterval(30)) == .speaking)
        activity.isAudible = false
        activity.lastAudible = now.addingTimeInterval(30)
        #expect(activity.status(at: now.addingTimeInterval(30.6)) == .speaking)
        #expect(activity.status(at: now.addingTimeInterval(31)) == .delayed)
    }

}
