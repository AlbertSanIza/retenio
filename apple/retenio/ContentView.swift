import AVFoundation
import SwiftUI
import SafariServices

struct ContentView: View {
    @State private var call = LiveCall()
    @State private var selectedSource: CallActivity.Source?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let voiceY = height * 0.36
            let detailTop = voiceY + 88
            let detailHeight = max(0, height - 146 - detailTop)
            ZStack(alignment: .top) {
                CallBackground()
                Text("Retenio")
                    .font(.system(size: 72, weight: .semibold, design: .rounded))
                    .tracking(-2.5)
                    .foregroundStyle(.white)
                    .frame(width: width - 48, height: 92)
                    .scaleEffect(call.isPresentingCall ? 2.0 / 3 : 1)
                    .position(x: width / 2, y: call.isPresentingCall ? 58 : voiceY)
                    .animation(reduceMotion ? nil : .smooth(duration: 0.55), value: call.isPresentingCall)

                callTimer
                    .frame(width: width - 48, height: 28)
                    .position(x: width / 2, y: 112)
                    .opacity(call.isPresentingCall ? 1 : 0)
                    .animation(.easeInOut(duration: 0.3), value: call.isPresentingCall)

                CallVoiceVisual(call: call, tint: activityColor)
                    .frame(width: 240, height: 140)
                    .position(x: width / 2, y: voiceY)
                    .opacity(call.isPresentingCall ? 1 : 0)
                    .animation(.easeInOut(duration: 0.4), value: call.isPresentingCall)
                    .accessibilityIdentifier("voice-visualizer")

                ScrollView(.vertical, showsIndicators: false) {
                    callDetails.padding(.vertical, 4)
                }
                .frame(width: min(width - 48, 500), height: detailHeight, alignment: .top)
                .position(x: width / 2, y: detailTop + detailHeight / 2)
                .opacity(call.isPresentingCall ? 1 : 0)
                .allowsHitTesting(call.isPresentingCall)
                .accessibilityHidden(!call.isPresentingCall)
                .animation(.easeInOut(duration: 0.3), value: call.isPresentingCall)

                controls
                    .frame(width: min(width - 48, 360), height: 112)
                    .position(x: width / 2, y: height - 64)
            }
        }
        #if DEBUG
        .task {
            // Explicit developer launch only; never runs during a normal app launch.
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("--voice-hangup-test") { await call.runHangupSmokeTest() }
            else if arguments.contains("--voice-tools-test") { await call.runToolsSmokeTest() }
            else if arguments.contains("--voice-smoke-test") { await call.runSmokeTest() }
        }
        #endif
        .preferredColorScheme(.dark)
        .sensoryFeedback(.success, trigger: call.phase == .connected)
        .sensoryFeedback(.selection, trigger: call.isMuted)
        .sheet(item: $selectedSource) { source in
            SourceBrowser(url: source.url).ignoresSafeArea()
        }
        .alert("Couldn't continue the call", isPresented: Binding(
            get: { call.errorMessage != nil }, set: { if !$0 { call.dismissError() } }
        )) {
            Button("OK", role: .cancel) { call.dismissError() }
        } message: { Text(call.errorMessage ?? "Please try again.") }
        .onChange(of: scenePhase) { _, phase in
            // Foreground-only prototype: don't leave a billable microphone session running offscreen.
            if phase == .background { call.end() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.didBecomeInactiveNotification)) { _ in
            if call.phase == .connected { call.end() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.mediaServicesWereResetNotification)) { _ in call.end() }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { notification in
            if let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
               reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { call.end() }
        }
    }

    private var callTimer: some View {
        Group {
            if let started = call.startedAt, call.phase == .connected {
                Text(started, style: .timer).monospacedDigit()
            } else {
                Text(call.phase == .ending ? "Ending call…" : "Connecting…")
            }
        }
        .font(.system(size: 18, weight: .regular, design: .rounded))
        .foregroundStyle(.mint.opacity(0.8))
        .accessibilityHidden(!call.isPresentingCall)
    }

    private var callDetails: some View {
        VStack(spacing: 14) {
            HStack(spacing: 8) {
                if !call.activity.work.isEmpty && call.activityStatus != .speaking {
                    ProgressView().tint(activityColor).scaleEffect(0.75)
                } else {
                    Image(systemName: activitySymbol).contentTransition(.symbolEffect(.replace))
                }
                Text(activityTitle).contentTransition(.numericText())
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(activityColor)
            .animation(.easeInOut(duration: 0.2), value: call.activityStatus)
            .accessibilityIdentifier("call-activity")

            if let notice = call.activity.notice, let date = call.activity.noticeAt,
               call.now.timeIntervalSince(date) < 8 {
                Text(notice).font(.system(size: 13)).foregroundStyle(.white.opacity(0.65))
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 12) {
                if !call.activity.userCaption.isEmpty {
                    caption(call.activity.userCaption, label: "YOU", opacity: 0.55, lines: 2)
                }
                if !call.activity.assistantCaption.isEmpty {
                    caption(call.activity.assistantCaption, label: "RETENIO", opacity: 0.95, lines: 3)
                }
            }
            .frame(minHeight: 100, alignment: .top)
            .accessibilityIdentifier("call-captions")

            if !call.activity.sources.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(call.activity.sources) { source in
                            Button { selectedSource = source } label: {
                                Label(source.url.host ?? source.title, systemImage: "arrow.up.right")
                                    .lineLimit(1).font(.system(size: 11, weight: .medium))
                            }
                            .accessibilityLabel("Source: \(source.title)")
                        }
                    }
                }
                .foregroundStyle(.mint)
            }

            if call.activityStatus == .delayed || call.activity.work.values.contains(where: { call.now.timeIntervalSince($0.started) > 12 }) {
                Button("Still there?", action: call.nudge)
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.mint)
                    .accessibilityIdentifier("call-nudge")
            } else if call.phase == .connected && call.activity.userCaption.isEmpty && call.activity.work.isEmpty {
                HStack(spacing: 12) {
                    suggestion("Surprise me", symbol: "sparkles", prompt: "Teach me one surprising, reliable idea and ask me a fun question about it.")
                    suggestion("Quiz my cards", symbol: "brain.head.profile", prompt: "Quiz me on one of my due Retenio cards. Fetch a question and wait for my answer.")
                }
            }
        }

    }

    private var controls: some View {
        HStack(alignment: .top, spacing: 0) {
            CallControl(symbol: call.isSpeaker ? "speaker.wave.2.fill" : "ear.fill", title: "Audio", selected: call.isSpeaker,
                        disabled: call.phase != .connected, action: call.toggleSpeaker)
                .accessibilityValue(call.isSpeaker ? "Speaker" : "Default audio route")
                .opacity(call.isPresentingCall ? 1 : 0)
                .allowsHitTesting(call.isPresentingCall)
                .accessibilityHidden(!call.isPresentingCall)
            Spacer(minLength: 16)
            CallToggleButton(active: call.isPresentingCall, disabled: call.phase == .ending) {
                if call.isPresentingCall { call.end() } else { call.start() }
            }
            Spacer(minLength: 16)
            CallControl(symbol: call.isMuted ? "mic.slash.fill" : "mic.fill", title: call.isMuted ? "Unmute" : "Mute", selected: call.isMuted,
                        disabled: call.phase != .connected, action: call.toggleMute)
                .opacity(call.isPresentingCall ? 1 : 0)
                .allowsHitTesting(call.isPresentingCall)
                .accessibilityHidden(!call.isPresentingCall)
        }
        .animation(.easeInOut(duration: 0.3), value: call.isPresentingCall)
    }

    private func caption(_ text: String, label: String, opacity: Double, lines: Int) -> some View {
        VStack(spacing: 5) {
            Text(label).font(.system(size: 9, weight: .semibold)).tracking(2).foregroundStyle(.white.opacity(0.35))
            Text(text).font(.system(size: label == "YOU" ? 15 : 18, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(opacity)).multilineTextAlignment(.center)
                .lineLimit(lines).truncationMode(.head)
        }
        .frame(maxWidth: .infinity)
    }

    private func suggestion(_ title: String, symbol: String, prompt: String) -> some View {
        Button { call.ask(prompt) } label: {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 13).padding(.vertical, 10)
                .background(.white.opacity(0.08), in: Capsule())
        }
        .foregroundStyle(.white.opacity(0.8))
    }

    private var activityTitle: String {
        if call.phase == .connecting { return "Connecting your call…" }
        if call.phase == .ending || call.isFinishingByVoice { return "See you next time" }
        switch call.activityStatus {
        case .listening: return call.isMuted ? "Microphone muted" : "I'm listening"
        case .speaking: return "Retenio is speaking"
        case .waiting: return "Waiting for a reply…"
        case .thinking: return "Working on your question…"
        case .searching: return "Searching the web…"
        case .reviewing: return "Checking your cards…"
        case .saving: return "Saving your review…"
        case .delayed: return "Taking longer than usual…"
        case .interrupted: return "Checking the connection…"
        }
    }

    private var activityColor: Color {
        if !call.isPresentingCall { return Color(red: 0.64, green: 1, blue: 0.87) }
        return switch call.activityStatus {
        case .searching: .cyan
        case .thinking, .reviewing, .saving: Color(red: 1, green: 0.84, blue: 0.53)
        case .delayed, .interrupted: .orange
        default: Color(red: 0.64, green: 1, blue: 0.87)
        }
    }

    private var activitySymbol: String {
        switch call.activityStatus {
        case .speaking: "waveform"
        case .searching: "globe"
        case .thinking, .waiting: "sparkles"
        case .reviewing: "brain.head.profile"
        case .saving: "checkmark.circle"
        case .delayed: "hourglass"
        case .interrupted: "wifi.exclamationmark"
        case .listening: call.isMuted ? "mic.slash.fill" : "mic.fill"
        }
    }

}

private struct CallBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.02, green: 0.34, blue: 0.29), Color(red: 0.01, green: 0.18, blue: 0.16)], startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [Color.mint.opacity(0.16), .clear], center: .topLeading, startRadius: 0, endRadius: 650)
        }
        .ignoresSafeArea()
    }
}

/// This small observation scope keeps level packets out of the caption/layout tree.
private struct CallVoiceVisual: View {
    let call: LiveCall
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        VoiceVisualizer(level: call.level, active: call.phase == .connected, tint: tint, reduceMotion: reduceMotion, visible: call.isPresentingCall)
            .accessibilityHidden(true)
    }
}

private struct CallToggleButton: View {
    let active: Bool
    let disabled: Bool
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Button(action: action) {
            Image(systemName: "phone.fill")
                .font(.system(size: 31, weight: .semibold))
                .rotationEffect(.degrees(active ? 135 : 0))
                .foregroundStyle(.white)
                .frame(width: 86, height: 86)
                .background(active ? Color(red: 0.93, green: 0.18, blue: 0.27) : Color(red: 0.12, green: 0.76, blue: 0.42), in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.18)))
                .opacity(disabled ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .animation(reduceMotion ? .none : .smooth(duration: 0.4), value: active)
        .accessibilityLabel(active ? "End call" : "Start call")
        .accessibilityIdentifier("call-toggle")
    }
}

private struct CallControl: View {
    var symbol: String
    var title: String
    var selected = false
    var disabled = false
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 26, weight: .medium))
                    .frame(width: 70, height: 70)
                    .background(.white.opacity(selected ? 0.2 : 0.09), in: Circle())
                    .overlay(Circle().strokeBorder(.white.opacity(0.18)))
                Text(title).font(.system(size: 14, weight: .medium))
            }
            .foregroundStyle(.white)
            .opacity(disabled ? 0.45 : 1)
        }
        .disabled(disabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier("call-\(title.lowercased())")
    }
}

#Preview { ContentView() }

private struct SourceBrowser: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
