import AVFoundation
import Combine
import Foundation
import Observation
import UIKit

@MainActor @Observable
final class LiveCall {
    enum Phase { case idle, connecting, connected, ending }
    private(set) var phase: Phase = .idle {
        didSet { updateProximityMonitoring() }
    }
    private(set) var isMuted = false
    private(set) var isSpeaker = true
    private(set) var startedAt: Date?
    private(set) var level: Float = 0
    var errorMessage: String?
    var isPresentingCall: Bool { phase != .idle }
    private(set) var activity = CallActivity()
    private(set) var activityStatus = CallActivity.Status.listening
    private let audio = VoiceAudio()
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var connectionTask: Task<Void, Never>?
    private var sendTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var closeSendTask: Task<Void, Never>?
    private var closeTask: Task<Void, Never>?
    private var healthTask: Task<Void, Never>?
    private var callID = UUID()
    @ObservationIgnored private var lastPong = Date()

    @ObservationIgnored private var audioNotifications: AnyCancellable?

    init() {
        let center = NotificationCenter.default
        audioNotifications = center.publisher(for: AVAudioSession.didBecomeInactiveNotification)
            .merge(
                with: center.publisher(for: AVAudioSession.mediaServicesWereResetNotification),
                center.publisher(for: AVAudioSession.routeChangeNotification),
            )
            .receive(on: RunLoop.main)
            .sink { [weak self] notification in
                guard let self else { return }
                switch notification.name {
                case AVAudioSession.didBecomeInactiveNotification:
                    if let context = notification.userInfo?[AVAudioSession.deactivationContextKey] as? AVAudioSession.DeactivationContext,
                        context.source == .system
                    {
                        self.end()
                    }
                case AVAudioSession.routeChangeNotification:
                    if let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                        AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable
                    {
                        self.end()
                    }
                    self.updateProximityMonitoring()
                default: self.end()
                }
            }
    }

    func start() {
        guard phase == .idle else { return }
        guard AVAudioApplication.shared.recordPermission == .granted else {
            errorMessage = "Enable microphone access for Retenio in Settings."
            return
        }
        guard let key = VoiceConfiguration.apiKey, !key.isEmpty else {
            errorMessage = "Voice is unavailable in this build. Please install a configured build."
            return
        }
        errorMessage = nil
        activity = CallActivity()
        refreshActivityStatus()
        phase = .connecting
        isMuted = false
        isSpeaker = true
        callID = UUID()
        let id = callID
        connectionTask = Task { [weak self] in
            guard let self, self.callID == id, !Task.isCancelled else { return }
            var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/live/sessions")!)
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            let session = URLSession(configuration: .ephemeral)
            self.session = session
            let socket = session.webSocketTask(with: request)
            socket.maximumMessageSize = 8 * 1024 * 1024
            self.socket = socket
            socket.resume()
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(25))
                guard !Task.isCancelled, self?.callID == id, self?.phase == .connecting else { return }
                self?.fail("The call couldn't connect. Check your connection and try again.")
            }
            do {
                try await send(LiveSessionConfiguration.startEvent, id: id)
                while !Task.isCancelled {
                    let message = try await socket.receive()
                    guard callID == id else { return }
                    let data: Data
                    switch message {
                    case .data(let value): data = value
                    case .string(let value): data = Data(value.utf8)
                    @unknown default: continue
                    }
                    guard let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                    try await receive(event, id: id)
                }
            } catch {
                guard callID == id, !Task.isCancelled else { return }
                if phase == .ending {
                    cleanup()
                } else if let audioError = error as? VoiceAudio.AudioError {
                    fail(audioError.localizedDescription)
                } else {
                    fail("The voice connection closed. Please try again.")
                }
            }
        }
    }

    private func receive(_ event: [String: Any], id: UUID) async throws {
        if (phase == .connecting || phase == .connected), event["type"] as? String != "session.output_audio.delta" {
            var updated = activity
            updated.receive(event)
            if updated != activity { activity = updated }
            refreshActivityStatus()
        }
        switch event["type"] as? String {
        case "session.started":
            guard phase == .connecting else { return }
            let (stream, continuation) = AsyncStream<Data>.makeStream(bufferingPolicy: .bufferingOldest(50))
            try await audio.start(
                onPCM: { [weak self] data in
                    if case .dropped = continuation.yield(data) {
                        continuation.finish()
                        Task { @MainActor [weak self] in
                            guard let self, self.callID == id, self.phase == .connecting || self.phase == .connected else { return }
                            self.fail("The connection is too slow for live audio. Try a stronger connection.")
                        }
                    }
                },
                onLevel: { [weak self] value in
                    Task { @MainActor [weak self] in
                        guard let self, self.callID == id, self.phase == .connecting || self.phase == .connected else { return }
                        self.level = value
                        let audible = value > 0.04
                        if self.activity.isAudible != audible {
                            self.activity.isAudible = audible
                            if audible { self.activity.awaitingReplySince = nil } else { self.activity.lastAudible = .now }
                            self.refreshActivityStatus()
                        }
                    }
                },
                onFailure: { [weak self] message in
                    Task { @MainActor [weak self] in
                        guard let self, self.callID == id, self.phase == .connecting || self.phase == .connected else { return }
                        self.fail(message)
                    }
                }, )
            guard callID == id, phase == .connecting else {
                continuation.finish()
                return
            }
            phase = .connected
            startedAt = .now
            timeoutTask?.cancel()
            sendTask = Task { [weak self] in
                for await pcm in stream {
                    guard let self, self.callID == id, self.phase == .connected, !Task.isCancelled else { break }
                    do {
                        try await self.send(
                            [
                                "type": "session.input_audio.append",
                                "audio": (self.isMuted ? Data(count: pcm.count) : pcm).base64EncodedString(),
                            ], id: id, )
                    } catch {
                        if self.callID == id, self.phase == .connected, !Task.isCancelled {
                            self.fail("Couldn't send audio. Please try again.")
                        }
                        break
                    }
                }
                continuation.finish()
            }
            lastPong = .now
            healthTask = Task { [weak self] in
                var lastPing = Date.distantPast
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    guard !Task.isCancelled, let self, self.callID == id else { return }
                    self.refreshActivityStatus()
                    if Date.now.timeIntervalSince(self.lastPong) > 25 {
                        self.fail("The call stopped responding. Start a new call to reconnect.")
                        return
                    }
                    if Date.now.timeIntervalSince(lastPing) >= 10 {
                        lastPing = .now
                        self.socket?.sendPing { [weak self] error in
                            Task { @MainActor [weak self] in
                                guard let self, self.callID == id, self.phase == .connected else { return }
                                if error != nil {
                                    self.fail("The voice connection closed. Please try again.")
                                } else {
                                    self.lastPong = .now
                                }
                            }
                        }
                    }
                }
            }
        case "session.output_audio.delta":
            guard phase == .connected, let delta = event["delta"] as? String, let pcm = Data(base64Encoded: delta)
            else { return }
            try await audio.play(pcm)
        case "session.closed": cleanup()
        case "error", "session.error": fail("Couldn't continue this call. Please try again.")
        default: break
        }
    }

    private func send(_ event: [String: Any], id: UUID) async throws {
        guard callID == id, let socket else { return }
        let data = try JSONSerialization.data(withJSONObject: event, options: .withoutEscapingSlashes)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    private func updateProximityMonitoring() {
        guard UIDevice.current.userInterfaceIdiom == .phone else { return }
        // Use the hardware route, not the speaker toggle: .none can route to headphones.
        UIDevice.current.isProximityMonitoringEnabled =
            phase == .connected
            && AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInReceiver }
    }

    func toggleMute() {
        guard phase == .connected else { return }
        isMuted.toggle()
        audio.setMuted(isMuted)
    }

    func toggleSpeaker() {
        guard phase == .connected else { return }
        let enabled = !isSpeaker
        let id = callID
        isSpeaker = enabled
        Task {
            do { try await audio.setSpeaker(enabled) } catch {
                if callID == id {
                    isSpeaker = !enabled
                    errorMessage = "Couldn't change audio route."
                }
            }
        }
    }

    func end() {
        guard phase != .idle, phase != .ending else { return }
        guard phase == .connected else {
            cleanup()
            return
        }
        phase = .ending
        audio.stop()
        sendTask?.cancel()
        healthTask?.cancel()
        let id = callID
        closeSendTask = Task { try? await send(["type": "session.close"], id: id) }
        closeTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, callID == id else { return }
            cleanup()
        }
    }

    private func refreshActivityStatus() {
        let status = activity.status(at: .now)
        if activityStatus != status { activityStatus = status }
    }

    private func fail(_ message: String) {
        errorMessage = message
        cleanup()
    }
    private func cleanup() {
        callID = UUID()
        connectionTask?.cancel()
        connectionTask = nil
        sendTask?.cancel()
        sendTask = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        closeSendTask?.cancel()
        closeSendTask = nil
        closeTask?.cancel()
        closeTask = nil
        healthTask?.cancel()
        healthTask = nil
        audio.stop()
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        session?.invalidateAndCancel()
        session = nil
        phase = .idle
        startedAt = nil
        level = 0
        activity = CallActivity()
        refreshActivityStatus()
    }
}
