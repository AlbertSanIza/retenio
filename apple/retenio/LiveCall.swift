import AVFoundation
import Foundation
import Observation
import OSLog

@MainActor @Observable
final class LiveCall {
    enum Phase { case idle, connecting, connected, ending }
    private(set) var phase: Phase = .idle
    private(set) var isMuted = false
    private(set) var isSpeaker = true
    private(set) var startedAt: Date?
    private(set) var level: Float = 0
    var errorMessage: String?
    private(set) var activity = CallActivity()
    private(set) var now = Date()
    var activityStatus: CallActivity.Status {
        activity.status(at: now)
    }
    private var healthTask: Task<Void, Never>?
    private var lastNudge = Date.distantPast
    private var voiceHangupTask: Task<Void, Never>?
    private var voiceHangup: VoiceHangup?
    private(set) var isFinishingByVoice = false
    private var handledFunctionCalls: Set<String> = []
    @ObservationIgnored private var lastInputEndMS: Double = 0
    @ObservationIgnored private var lastServerEvent = Date()
    #if DEBUG
    private var endedByVoice = false
    private var backendCompletions = 0
    private var observedTools: Set<String> = []
    private var observedStatuses: Set<String> = []
    #endif
    private let audio = VoiceAudio()
    private let logger = Logger(subsystem: "com.albertsaniza.retenio", category: "VoiceCall")
    private var receivedAudio = false
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var connectionTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var closingTask: Task<Void, Never>?
    private var callID = UUID()
    private var audioSendTask: Task<Void, Never>?
    var isPresentingCall: Bool { phase != .idle }

    func start() {
        guard phase == .idle else { return }
        guard let key = VoiceConfiguration.apiKey, !key.isEmpty else {
            errorMessage = "Voice is unavailable in this build. Please install the latest Retenio build."
            return
        }
        errorMessage = nil
        receivedAudio = false
        activity = CallActivity()
        lastServerEvent = .now
        now = .now
        lastNudge = .distantPast
        cancelVoiceHangup()
        handledFunctionCalls = []
        lastInputEndMS = 0
        #if DEBUG
        endedByVoice = false
        #endif
        phase = .connecting
        isMuted = false
        isSpeaker = true
        startedAt = nil
        callID = UUID()
        let id = callID
        connectionTask = Task { [weak self] in
            guard await AVAudioApplication.requestRecordPermission() else {
                guard self?.callID == id else { return }
                self?.fail("Microphone access is off. Enable it for Retenio in iPhone Settings, then try again.")
                return
            }
            guard let self, self.callID == id, !Task.isCancelled else { return }
            var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/live/sessions")!)
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 30
            let session = URLSession(configuration: configuration)
            self.session = session
            let socket = session.webSocketTask(with: request)
            // MCP image results can exceed 3 MB once wrapped in a backend event.
            socket.maximumMessageSize = 8 * 1024 * 1024
            self.socket = socket
            socket.resume()
            self.send(LiveSessionConfiguration.startEvent, id: id)
            self.timeoutTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(25))
                guard !Task.isCancelled, self?.callID == id, self?.phase == .connecting else { return }
                self?.fail("The call couldn't connect. Check your internet connection and try again.")
            }
            do {
                while !Task.isCancelled {
                    let message = try await socket.receive()
                    guard self.callID == id else { return }
                    let data: Data
                    switch message {
                    case .data(let value): data = value
                    case .string(let value): data = Data(value.utf8)
                    @unknown default: continue
                    }
                    await self.receive(data, id: id)
                }
            } catch {
                guard self.callID == id, !Task.isCancelled else { return }
                if self.phase == .ending { self.cleanup() }
                else { self.fail("The voice connection closed. Check your internet connection and try again.") }
            }
        }
    }

    private func receive(_ data: Data, id: UUID) async {
        guard let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = event["type"] as? String else { return }
        lastServerEvent = .now
        // Audio packets arrive continuously, including silence. Do not invalidate the
        // whole screen for each packet; the health timer publishes liveness separately.
        if type != "session.output_audio.delta" {
            activity.receive(event)
            now = .now
        }
        #if DEBUG
        for work in activity.work.values { observedStatuses.insert(work.status.rawValue) }
        #endif
        switch type {
        case "session.input_transcript.delta":
            if let voiceHangup, voiceHangup.isNewSpeech(event) {
                cancelVoiceHangup()
                send(["type": "session.instructions.append", "delegation_id": NSNull(),
                      "content": "The learner resumed speaking, so the pending hang-up was canceled. Listen to the new request. Only request end_call again if they still clearly want to end the call."], id: id)
            }
            if let end = (event["end_ms"] as? NSNumber)?.doubleValue { lastInputEndMS = max(lastInputEndMS, end) }
        case "session.started":
            guard phase == .connecting else { return }
            do {
                let (stream, continuation) = AsyncStream<Data>.makeStream(bufferingPolicy: .bufferingOldest(50))
                try await audio.start(onPCM: { [weak self] data in
                    if case .dropped = continuation.yield(data) {
                        Task { @MainActor [weak self] in
                            guard self?.callID == id else { return }
                            self?.fail("Your connection is too slow for live audio. Please try again on a stronger connection.")
                        }
                    }
                }, onLevel: { [weak self] value in
                    Task { @MainActor [weak self] in
                        guard self?.callID == id else { return }
                        self?.level = value
                        if value > 0.04, let self,
                           Date.now.timeIntervalSince(self.activity.lastAudible ?? .distantPast) > 0.25 {
                            self.activity.lastAudible = .now
                        }
                    }
                }, onFailure: { [weak self] message in
                    Task { @MainActor [weak self] in
                        guard self?.callID == id else { return }
                        self?.fail(message)
                    }
                })
                guard callID == id, phase == .connecting else { return }
                audioSendTask = Task { [weak self] in
                    // A single consumer preserves microphone packet order and bounds backpressure.
                    for await data in stream {
                        guard let self, self.callID == id, self.phase == .connected,
                              !Task.isCancelled, let socket = self.socket else { break }
                        let outgoing = self.isMuted ? Data(count: data.count) : data
                        do {
                            let event = ["type": "session.input_audio.append", "audio": outgoing.base64EncodedString()]
                            let encoded = try JSONSerialization.data(withJSONObject: event)
                            try await socket.send(.string(String(decoding: encoded, as: UTF8.self)))
                        } catch {
                            if self.callID == id, self.phase == .connected {
                                self.fail("Couldn't send microphone audio. Please check your connection and try again.")
                            }
                            break
                        }
                    }
                    continuation.finish()
                }
                timeoutTask?.cancel()
                phase = .connected
                startedAt = .now
                monitorHealth(id: id)
                logger.info("Live session connected; native microphone started.")
            } catch { if callID == id { fail(error.localizedDescription) } }
        case "session.output_audio.delta":
            guard phase == .connected, let encoded = event["delta"] as? String,
                  let pcm = Data(base64Encoded: encoded) else { return }
            do {
                try await audio.play(pcm)
                guard callID == id else { return }
                if !receivedAudio {
                    receivedAudio = true
                    logger.info("Received and scheduled first assistant audio buffer.")
                }
            } catch { if callID == id { fail(error.localizedDescription) } }
        case "response.event":
            handleBackendEvent(event, id: id)
        case "session.closed":
            logger.info("Server acknowledged session close.")
            cleanup()
        case "error", "session.error":
            let details = event["error"] as? [String: Any]
            let code = details?["code"] as? String ?? "unknown"
            logger.error("Live error code: \(code, privacy: .public)")
            switch code {
            case "responses_validation_failed":
                fail("The learning tools couldn't connect. Please try a new call.")
            case "invalid_api_key": fail("Voice is temporarily unavailable. Please try again later.")
            case "insufficient_quota", "rate_limit_exceeded": fail("Voice is busy right now. Please try again later.")
            case "model_not_found", "permission_denied": fail("Voice is temporarily unavailable. Please try again later.")
            default: fail("Couldn't continue this call. Please try again.")
            }
        default: break
        }
    }

    private func handleBackendEvent(_ envelope: [String: Any], id: UUID) {
        guard let event = envelope["event"] as? [String: Any], let type = event["type"] as? String else { return }
        #if DEBUG
        if type == "response.completed" { backendCompletions += 1 }
        if type == "response.output_item.done", let item = event["item"] as? [String: Any] {
            if let tool = item["name"] as? String { observedTools.insert(tool) }
            if item["type"] as? String == "web_search_call" { observedTools.insert("web_search") }
        }
        #endif
        if type == "response.output_item.done", let item = event["item"] as? [String: Any],
           item["type"] as? String == "function_call", let functionID = item["call_id"] as? String,
           handledFunctionCalls.insert(functionID).inserted {
            let result: String
            switch item["name"] as? String {
            case "end_call":
                requestVoiceHangup(id: id)
                result = "{\"status\":\"ending\",\"message\":\"The call will close after a short farewell. Say goodbye briefly, with no follow-up question.\"}"
            case "cancel_end_call":
                cancelVoiceHangup()
                result = "{\"status\":\"continuing\",\"message\":\"The call remains open. Continue the conversation.\"}"
            default:
                result = "{\"error\":\"Unsupported action\"}"
            }
            submit([
                ["type": "response.item.create", "item": ["type": "function_call_output", "call_id": functionID, "output": result]],
                ["type": "response.create"]
            ], id: id)
        }
        if type == "response.output_item.done", let item = event["item"] as? [String: Any],
           item["type"] as? String == "mcp_approval_request", let approvalID = item["id"] as? String {
            // No configured tool requires a separate approval. If an unexpected one arrives,
            // decline it and explain aloud instead of stranding a hands-free caller on a dialog.
            submit([
                ["type": "response.item.create", "item": ["type": "mcp_approval_response",
                    "approval_request_id": approvalID, "approve": false]],
                ["type": "response.create"]
            ], id: id)
            send(["type": "session.commentary.append", "delegation_id": NSNull(),
                  "content": "That action could not run hands-free, so it was not performed. Tell the learner briefly and continue the conversation. Do not ask them to press a button."], id: id)
        }
        if ["response.failed", "response.incomplete", "response.cancelled"].contains(type) {
            send(["type": "session.commentary.append", "delegation_id": NSNull(),
                  "content": "The background request did not finish successfully. Briefly acknowledge this and offer to try again or discuss another topic. Do not claim the task succeeded."], id: id)
        }
    }

    private func requestVoiceHangup(id: UUID) {
        guard callID == id, phase == .connected, voiceHangup == nil else { return }
        let request = VoiceHangup(requestedAt: .now, inputEndMS: lastInputEndMS)
        voiceHangup = request
        isFinishingByVoice = true
        voiceHangupTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard !Task.isCancelled, let self, self.callID == id, self.phase == .connected else { return }
                let finished = await self.audio.farewellFinished(after: request.requestedAt)
                guard !Task.isCancelled, self.callID == id else { return }
                if request.shouldEnd(at: .now, farewellFinished: finished) {
                    #if DEBUG
                    self.endedByVoice = true
                    print("Voice hang-up: closing after farewell or deadline")
                    #endif
                    self.end()
                    return
                }
            }
        }
    }

    private func cancelVoiceHangup() {
        voiceHangupTask?.cancel()
        voiceHangupTask = nil
        voiceHangup = nil
        isFinishingByVoice = false
    }

    func ask(_ text: String) {
        guard phase == .connected, activity.work.isEmpty else { return }
        activity.requested(text)
        // Typed prompts use the same managed backend and feed results into the voice conversation.
        submit([
            ["type": "response.item.create", "item": ["type": "message", "role": "user",
                "content": [["type": "input_text", "text": text]]]],
            ["type": "response.create"]
        ], id: callID)
    }

    func nudge() {
        guard phase == .connected, Date.now.timeIntervalSince(lastNudge) > 10 else { return }
        lastNudge = .now
        activity.report("Checking in…")
        send(["type": "session.instructions.append", "delegation_id": NSNull(),
              "content": "The learner tapped Still there because of a long silence. Respond briefly now. If a backend task is pending, accurately acknowledge the wait without claiming it is complete; otherwise answer their last question or ask a brief clarification."], id: callID)
    }

    private func submit(_ events: [[String: Any]], id: UUID) {
        Task {
            do {
                for var event in events {
                    guard callID == id, phase == .connected, let socket else { return }
                    event["event_id"] = UUID().uuidString
                    let data = try JSONSerialization.data(withJSONObject: event)
                    try await socket.send(.string(String(decoding: data, as: UTF8.self)))
                }
            } catch {
                guard callID == id else { return }
                activity.report("Couldn't send that request. Please try again.")
            }
        }
    }

    private func monitorHealth(id: UUID) {
        healthTask?.cancel()
        healthTask = Task { [weak self] in
            var ticks = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled, let self, self.callID == id, self.phase == .connected else { return }
                self.now = .now
                self.activity.lastEvent = self.lastServerEvent
                ticks += 1
                if ticks.isMultiple(of: 10) {
                    self.socket?.sendPing { [weak self] error in
                        guard error != nil else { return }
                        Task { @MainActor [weak self] in
                            guard self?.callID == id else { return }
                            self?.fail("The connection was interrupted. Start a new call to reconnect.")
                        }
                    }
                }
                if self.now.timeIntervalSince(self.activity.lastEvent) > 25 {
                    self.fail("The call stopped receiving audio. Start a new call to reconnect.")
                    return
                }
            }
        }
    }

    private func send(_ event: [String: Any], id: UUID) {
        guard let socket, callID == id else { return }
        var event = event
        event["event_id"] = UUID().uuidString
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { [weak self] error in
            Task { @MainActor [weak self] in
                guard let self, self.callID == id else { return }
                if error != nil {
                    if self.phase == .ending { self.cleanup() }
                    else { self.fail("Couldn't send audio to OpenAI. Check your internet connection and try again.") }
                }
            }
        }
    }

    func toggleMute() {
        guard phase == .connected else { return }
        isMuted.toggle()
        audio.setMuted(isMuted)
        logger.info("Microphone mute changed: \(self.isMuted)")
        send(["type": isMuted ? "session.input_audio.mute" : "session.input_audio.unmute"], id: callID)
    }

    func toggleSpeaker() {
        guard phase == .connected else { return }
        let enabled = !isSpeaker
        let id = callID
        isSpeaker = enabled
        Task {
            do { try await audio.setSpeaker(enabled) }
            catch {
                guard callID == id else { return }
                isSpeaker = !enabled
                errorMessage = "Couldn't change the audio output. Check your connected headphones."
            }
        }
    }

    func end() {
        guard phase != .idle, phase != .ending else { return }
        let connected = phase == .connected
        cancelVoiceHangup()
        phase = .ending
        healthTask?.cancel()
        audioSendTask?.cancel()
        audio.stop()
        timeoutTask?.cancel()
        guard connected else { cleanup(); return }
        let id = callID
        send(["type": "session.close"], id: id)
        closingTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, self?.callID == id else { return }
            self?.cleanup()
        }
    }

    func dismissError() { errorMessage = nil }

    private func fail(_ message: String) {
        cleanup()
        errorMessage = message
    }

    private func cleanup() {
        cancelVoiceHangup()
        callID = UUID()
        healthTask?.cancel()
        timeoutTask?.cancel()
        closingTask?.cancel()
        connectionTask?.cancel()
        audio.stop()
        socket?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel()
        socket = nil
        session = nil
        audioSendTask?.cancel()
        audioSendTask = nil
        phase = .idle
        startedAt = nil
        level = 0
    }
}

#if DEBUG
extension LiveCall {
    func runHangupSmokeTest() async {
        start()
        for _ in 0..<100 {
            if phase != .connecting { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard phase == .connected else { print("Voice hang-up test FAIL: connection"); end(); return }
        try? await Task.sleep(for: .seconds(3))
        ask("Thanks, that's all for today. Goodbye, please hang up the call.")
        for _ in 0..<200 {
            try? await Task.sleep(for: .milliseconds(100))
            if phase == .idle { break }
        }
        let passed = endedByVoice && phase == .idle && errorMessage == nil
        print("Voice hang-up test \(passed ? "PASS" : "FAIL"): automaticEnd=\(endedByVoice), phase=\(phase)")
        end()
    }

    func runToolsSmokeTest() async {
        print("Live tools test: starting")
        start()
        for _ in 0..<100 {
            if phase != .connecting { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard phase == .connected else { print("Live tools test FAIL: connection"); end(); return }
        try? await Task.sleep(for: .seconds(3))
        var passed = true
        let prompts = [
            "Search the web for NASA's official Europa overview. Tell me one surprising fact with a citation.",
            "Quiz me on one of my due Retenio cards. Use get_random_questions and wait for my answer."
        ]
        for (index, prompt) in prompts.enumerated() {
            let baseline = backendCompletions
            ask(prompt)
            for _ in 0..<90 {
                try? await Task.sleep(for: .milliseconds(500))
                if backendCompletions > baseline || phase != .connected { break }
            }
            let completed = backendCompletions > baseline && activity.work.isEmpty
            passed = passed && completed
            if index == 0 { passed = passed && !activity.sources.isEmpty }
            print("Live tools test step \(index + 1): completed=\(completed), sources=\(activity.sources.count), activeTasks=\(activity.work.count)")
            if !completed { break }
            try? await Task.sleep(for: .seconds(4))
        }
        let playback = await audio.verifyPlaybackForTesting()
        passed = passed && playback && !activity.assistantCaption.isEmpty
            && observedTools.contains("web_search") && observedTools.contains("get_random_questions")
            && observedStatuses.contains("searching") && observedStatuses.contains("reviewing")
            && errorMessage == nil
        print("Live tools test \(passed ? "PASS" : "FAIL"): tools=\(observedTools.sorted()), statuses=\(observedStatuses.sorted()), captions=\(!activity.assistantCaption.isEmpty)")
        end()
    }

    /// Run on a physical iPhone with --voice-smoke-test to exercise the real I/O path.
    /// Uses short, billable Live sessions; no credential or conversation content is logged.
    func runSmokeTest() async {
        var passed = true
        for attempt in 1...2 {
            print("Voice smoke test: starting call \(attempt)")
            start()
            for _ in 0..<100 {
                if phase != .connecting { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
            guard phase == .connected else {
                print("Voice smoke test FAIL: connection, error=\(errorMessage ?? "none")")
                end()
                return
            }
            try? await Task.sleep(for: .seconds(5))
            let initialPlayback = await audio.verifyPlaybackForTesting()
            passed = passed && initialPlayback
            if attempt == 1 {
                toggleMute()
                try? await Task.sleep(for: .seconds(1))
                toggleSpeaker()
                try? await Task.sleep(for: .seconds(2))
                toggleSpeaker()
                try? await Task.sleep(for: .seconds(2))
                toggleMute()
                try? await Task.sleep(for: .seconds(5))
                let afterControls = await audio.verifyPlaybackForTesting()
                passed = passed && afterControls && phase == .connected && !isMuted && isSpeaker && errorMessage == nil
            }
            end()
            try? await Task.sleep(for: .seconds(3))
            passed = passed && phase == .idle && errorMessage == nil
            print("Voice smoke test: call \(attempt) ended, passed=\(passed)")
            if !passed { break }
        }
        print("Voice smoke test \(passed ? "PASS" : "FAIL"): playback, microphone capture, controls, end, and restart")
    }
}
#endif
