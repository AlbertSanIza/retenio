import Foundation

/// Event-derived UI state. Silence is never treated as evidence of reasoning or search.
struct CallActivity: Equatable {
    enum Status: String {
        case listening, speaking, waiting, thinking, searching, reviewing, saving, delayed
    }
    struct Work: Equatable {
        var status: Status
        var started: Date
    }
    struct Source: Identifiable, Equatable {
        var id: String { url.absoluteString }
        let title: String
        let url: URL
    }
    var userCaption = ""
    var assistantCaption = ""
    var sources: [Source] = []
    var work: [String: Work] = [:]
    var isAudible = false
    var lastAudible: Date?
    var awaitingReplySince: Date?
    var notice: String?
    private var userEndMS: Double?
    private var assistantEndMS: Double?

    mutating func receive(_ event: [String: Any], now: Date = .now) {
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
            case "response.web_search_call.completed", "response.mcp_call.completed",
                "response.mcp_list_tools.completed":
                work[id] = Work(status: .thinking, started: started)
            case "response.mcp_call.in_progress", "response.mcp_list_tools.in_progress":
                work[id] = Work(status: .reviewing, started: started)
            case "response.output_item.added", "response.output_item.done":
                if let item = nested["item"] as? [String: Any] {
                    if ["mcp_call", "function_call"].contains(item["type"] as? String ?? "") {
                        let name = item["name"] as? String ?? ""
                        if ["end_call", "cancel_end_call"].contains(name) {
                            work.removeValue(forKey: id)
                        } else {
                            work[id] = Work(
                                status: name == "rate_card" ? .saving : .reviewing,
                                started: started, )
                        }
                        if item["error"] != nil && !(item["error"] is NSNull) {
                            notice =
                                item["type"] as? String == "mcp_call"
                                ? "The MCP connection couldn't finish this request. You can keep talking."
                                : "That learning tool couldn't finish. You can keep talking."
                        }
                    }
                    collectSources(item)
                }
            case "response.output_text.annotation.added":
                if let annotation = nested["annotation"] as? [String: Any] { addSource(annotation) }
            case "response.completed":
                work.removeValue(forKey: id)
            case "response.failed", "response.incomplete", "response.cancelled":
                work.removeValue(forKey: id)
                notice = "That request couldn't finish. Try asking again."
            case "response.mcp_call.failed", "response.mcp_list_tools.failed":
                notice = "The MCP connection couldn't finish this request. You can keep talking."
            default: break
            }
        default: break
        }
    }

    func status(at now: Date) -> Status {
        if isAudible { return .speaking }
        if let recent = lastAudible, now.timeIntervalSince(recent) < 0.7 { return .speaking }
        if work.values.contains(where: { now.timeIntervalSince($0.started) > 20 }) { return .delayed }
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
        let previousEnd = user ? userEndMS : assistantEndMS
        let gap: Double = if let start, let previousEnd { start - previousEnd } else { 0 }
        let newUtterance = gap > 1600 || (user ? userCaption.isEmpty : assistantCaption.isEmpty)
        if user {
            userCaption = String(((newUtterance ? "" : userCaption) + delta).suffix(320))
            userEndMS = end ?? userEndMS
            awaitingReplySince = now
            if newUtterance {
                sources = []
                notice = nil
            }
        } else {
            assistantCaption = String(((newUtterance ? "" : assistantCaption) + delta).suffix(420))
            assistantEndMS = end ?? assistantEndMS
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
            !sources.contains(where: { $0.url == url }), sources.count < 6
        else { return }
        sources.append(Source(title: annotation["title"] as? String ?? url.host ?? "Source", url: url))
    }
}
