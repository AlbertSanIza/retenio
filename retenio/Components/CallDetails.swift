import SwiftUI

struct CallDetails: View {
    let call: LiveCall

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(RetenioTheme.accent)
                if !call.activity.userCaption.isEmpty {
                    Text(call.activity.userCaption).foregroundStyle(.white.opacity(0.55))
                }
                if !call.activity.assistantCaption.isEmpty {
                    Text(call.activity.assistantCaption).foregroundStyle(.white)
                }
                if let notice = call.activity.notice {
                    Text(notice).font(.caption).foregroundStyle(.white.opacity(0.7))
                }
                ForEach(call.activity.sources) { source in
                    Link(source.title, destination: source.url).font(.caption).foregroundStyle(RetenioTheme.accent)
                }
            }
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
    }

    private var title: String {
        if call.phase == .connecting { return "Connecting…" }
        if call.phase == .ending { return "See you next time" }
        switch call.activityStatus {
        case .speaking: return "Speaking"
        case .listening: return call.isMuted ? "Microphone muted" : "Listening"
        case .searching: return "Searching the web"
        case .reviewing: return "Finding your next question"
        case .saving: return "Saving your review"
        case .thinking: return "Thinking"
        case .waiting: return "Waiting for a reply"
        case .delayed: return "Taking a little longer…"
        }
    }
}
