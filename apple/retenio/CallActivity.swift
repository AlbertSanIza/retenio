import Foundation

/// Event-derived UI state. Silence is never treated as evidence of reasoning or search.
struct CallActivity {
    enum Status: String { case listening, speaking, waiting, thinking, searching, reviewing, saving, delayed, interrupted }
    struct Work {
        var status: Status
        var started: Date
    }
    struct Source: Identifiable {
        var id: String { url.absoluteString }
        let title: String
        let url: URL
    }
    var userCaption = ""
    var assistantCaption = ""
    var sources: [Source] = []
    var work: [String: Work] = [:]
    var lastEvent = Date()
    var lastUser: Date?
    var lastAssistant: Date?
    var lastAudible: Date?
    var awaitingReplySince: Date?
    var notice: String?
    var noticeAt: Date?
    private var userEndMS: Double?
    private var assistantEndMS: Double?

    mutating func receive(_ event: [String: Any], now: Date = .now) {
        lastEvent = now
        switch event["type"] as? String {
        case "session.input_transcript.delta":
            appendTranscript(event, user: true, now: now)
        case "session.output_transcript.delta":
            appendTranscript(event, user: false, now: now)
        case "session.delegation.created":
            let delegation = event["delegation"] as? [String: Any]
            let id = delegation?["id"] as? String ?? event["delegation_id"] as? String ?? "backend"
            work[id] = Work(status: .thinking, started: now)
        case "response.event":
            guard let nested = event["event"] as? [String: Any], let type = nested["type"] as? String else { return }
            let id = event["delegation_id"] as? String ?? "backend"
            let started = work[id]?.started ?? now
            switch type {
            case "response.created", "response.in_progress":
                work[id] = Work(status: .thinking, started: started)
            case "response.web_search_call.in_progress", "response.web_search_call.searching":
                work[id] = Work(status: .searching, started: started)
            case "response.web_search_call.completed", "response.mcp_call.completed", "response.mcp_list_tools.completed":
                work[id] = Work(status: .thinking, started: started)
            case "response.mcp_call.in_progress", "response.mcp_list_tools.in_progress":
                work[id] = Work(status: .reviewing, started: started)
            case "response.output_item.added", "response.output_item.done":
                if let item = nested["item"] as? [String: Any] {
                    if item["type"] as? String == "mcp_call" {
                        work[id] = Work(status: item["name"] as? String == "rate_question" ? .saving : .reviewing, started: started)
                        if item["error"] != nil && !(item["error"] is NSNull) { report("That learning tool couldn't finish. You can keep talking.", now: now) }
                    }
                    collectSources(item)
                }
            case "response.output_text.annotation.added":
                if let annotation = nested["annotation"] as? [String: Any] { addSource(annotation) }
            case "response.completed":
                work.removeValue(forKey: id)
            case "response.failed", "response.incomplete", "response.cancelled":
                work.removeValue(forKey: id)
                report("That request couldn't finish. Try asking again.", now: now)
            case "response.mcp_call.failed", "response.mcp_list_tools.failed":
                report("Your cards aren't available right now. We can still explore a topic.", now: now)
            default: break
            }
        default: break
        }
    }

    mutating func requested(_ text: String, now: Date = .now) {
        userCaption = text
        assistantCaption = ""
        sources = []
        lastUser = now
        awaitingReplySince = now
        notice = nil
        userEndMS = nil
    }

    mutating func report(_ message: String, now: Date = .now) {
        notice = message
        noticeAt = now
    }

    func status(at now: Date) -> Status {
        if now.timeIntervalSince(lastEvent) > 10 { return .interrupted }
        if let recent = lastAudible, now.timeIntervalSince(recent) < 0.7 { return .speaking }
        let priorities: [Status] = [.saving, .searching, .reviewing, .thinking]
        for candidate in priorities where work.values.contains(where: { $0.status == candidate }) { return candidate }
        if let since = awaitingReplySince, now.timeIntervalSince(since) > 1.2 {
            return now.timeIntervalSince(since) > 10 ? .delayed : .waiting
        }
        return .listening
    }

    private mutating func appendTranscript(_ event: [String: Any], user: Bool, now: Date) {
        guard let delta = event["delta"] as? String, !delta.isEmpty else { return }
        let start = (event["start_ms"] as? NSNumber)?.doubleValue
        let end = (event["end_ms"] as? NSNumber)?.doubleValue
        if user {
            let newUtterance = userEndMS == nil || (start != nil && start! - userEndMS! > 1600)
            userCaption = String(((newUtterance ? "" : userCaption) + delta).suffix(320))
            userEndMS = end
            lastUser = now
            awaitingReplySince = now
            if newUtterance { sources = [] }
        } else {
            let newUtterance = assistantEndMS == nil || (start != nil && start! - assistantEndMS! > 1600)
            assistantCaption = String(((newUtterance ? "" : assistantCaption) + delta).suffix(420))
            assistantEndMS = end
            lastAssistant = now
            awaitingReplySince = nil
        }
    }

    private mutating func collectSources(_ item: [String: Any]) {
        for part in item["content"] as? [[String: Any]] ?? [] {
            for annotation in part["annotations"] as? [[String: Any]] ?? [] { addSource(annotation) }
        }
    }

    private mutating func addSource(_ annotation: [String: Any]) {
        guard annotation["type"] as? String == "url_citation",
              let raw = annotation["url"] as? String, let url = URL(string: raw),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              !sources.contains(where: { $0.url == url }), sources.count < 6 else { return }
        sources.append(Source(title: annotation["title"] as? String ?? url.host ?? "Source", url: url))
    }
}
