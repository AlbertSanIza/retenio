import Foundation

let now = Date(timeIntervalSince1970: 1000)
func status(_ activity: CallActivity, after seconds: Double = 0) -> CallActivity.Status {
    activity.status(at: now.addingTimeInterval(seconds))
}
func backend(_ id: String, _ type: String, _ extra: [String: Any] = [:]) -> [String: Any] {
    ["type": "response.event", "delegation_id": id, "event": extra.merging(["type": type]) { _, new in new }]
}
var activity = CallActivity()
activity.lastEvent = now
assert(status(activity, after: 8) == .listening, "Silence must not fabricate reasoning activity")
assert(status(activity, after: 11) == .interrupted)
activity.receive(["type":"session.input_transcript.delta", "delta":"Why", "start_ms":0, "end_ms":200], now: now)
activity.receive(["type":"session.input_transcript.delta", "delta":" is the sky blue?", "start_ms":200, "end_ms":900], now: now)
assert(activity.userCaption == "Why is the sky blue?")
assert(status(activity, after: 2) == .waiting)
activity.receive(["type":"session.output_audio.delta"], now: now.addingTimeInterval(11))
assert(status(activity, after: 11) == .delayed, "Silent audio is not a spoken reply")
activity.receive(backend("a", "response.web_search_call.searching"), now: now)
activity.receive(backend("b", "response.mcp_call.in_progress"), now: now)
assert(status(activity) == .searching)
activity.receive(backend("a", "response.completed"), now: now)
assert(status(activity) == .reviewing, "Completing one job must not hide another")
activity.receive(backend("b", "response.failed"), now: now)
assert(activity.work.isEmpty && activity.notice != nil)
activity.receive(["type":"session.output_transcript.delta", "delta":"Sunlight scatters.", "start_ms":1000, "end_ms":1800], now: now)
assert(activity.assistantCaption == "Sunlight scatters." && activity.awaitingReplySince == nil)
activity.lastAudible = now
assert(status(activity) == .speaking)
assert(status(activity, after: 1) == .listening)
for url in ["javascript:alert(1)", "file:///etc/passwd", "https://science.nasa.gov", "https://science.nasa.gov"] {
    activity.receive(backend("s", "response.output_text.annotation.added", ["annotation":["type":"url_citation", "url":url, "title":"NASA"]]), now: now)
}
assert(activity.sources.count == 1, "Sources must be safe web links and deduplicated")
activity.receive(["type":"session.input_transcript.delta", "delta":"Another question", "start_ms":10000, "end_ms":11000], now: now)
assert(activity.userCaption == "Another question" && activity.sources.isEmpty)
activity.receive(["type":"session.input_transcript.delta", "delta":String(repeating:"x",count:2000), "start_ms":11000, "end_ms":12000], now: now)
assert(activity.userCaption.count == 320, "Captions must stay bounded during long calls")
print("PASS: real event status, silence, overlapping work, captions, failures, source links, and bounded memory")

let session = LiveSessionConfiguration.startEvent["session"] as! [String: Any]
let delegation = session["delegation"] as! [String: Any]
let responses = delegation["responses"] as! [String: Any]
let tools = responses["tools"] as! [[String: Any]]
let mcp = tools.first { $0["type"] as? String == "mcp" }!
assert(mcp["require_approval"] as? String == "never", "Spoken ratings must not trigger a UI approval")
assert(mcp["allowed_tools"] as? [String] == ["get_random_questions", "get_anki_image", "rate_question"])
print("PASS: hands-free ratings use the existing limited MCP tool set without approval dialogs")

let goodbye = VoiceHangup(requestedAt: now, inputEndMS: 1000)
assert(!goodbye.shouldEnd(at: now.addingTimeInterval(0.5), farewellFinished: true))
assert(!goodbye.shouldEnd(at: now.addingTimeInterval(2), farewellFinished: false))
assert(goodbye.shouldEnd(at: now.addingTimeInterval(2), farewellFinished: true))
assert(goodbye.shouldEnd(at: now.addingTimeInterval(6), farewellFinished: false))
assert(!goodbye.isNewSpeech(["start_ms":1050, "delta":"bye"]))
assert(!goodbye.isNewSpeech(["start_ms":2000, "delta":"."]))
assert(goodbye.isNewSpeech(["start_ms":2000, "delta":"Wait"]))
let endTool = tools.first { $0["name"] as? String == "end_call" }
assert(endTool?["type"] as? String == "function")
print("PASS: farewell grace period, bounded hang-up, interruption, and end-call tool registration")
