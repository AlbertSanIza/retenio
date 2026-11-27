@preconcurrency import AVFoundation
import Accelerate
import Foundation
import os

// AVAudioEngine and AVAudioSession are confined to this serial queue. Hardware setup
// must not block the main actor (voice-processing initialization can wait on system RPC).
nonisolated final class VoiceAudio: @unchecked Sendable {
    private static let audioQueue = DispatchQueue(label: "com.albertsaniza.retenio.audio", qos: .userInitiated)
    // Access only on audioQueue; AVAudioSession is shared by every window.
    nonisolated(unsafe) private static weak var sessionOwner: VoiceAudio?
    private let queue = VoiceAudio.audioQueue
    private var captureInput = true
    private var silenceTimer: DispatchSourceTimer?
    private let muted = OSAllocatedUnfairLock(initialState: false)
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var sessionActive = false
    private let logger = Logger(subsystem: "com.albertsaniza.retenio", category: "VoiceAudio")
    private var completedFrames = 0
    private var queuedFrames = 0
    private var generation = UUID()
    private var playbackGeneration = UUID()
    private var configurationObserver: NSObjectProtocol?
    private var onPCM: (@Sendable (Data) -> Void)?
    private var onFailure: (@Sendable (String) -> Void)?
    private struct PendingAudio {
        let id = UUID()
        let enqueuedAt = Date()
        let buffer: AVAudioPCMBuffer
        let audible: Bool
    }
    private var pendingAudio: [PendingAudio] = []
    private var lastAudiblePlayback: (enqueuedAt: Date, finishedAt: Date)?
    private let playbackFormat = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!
    private var onLevel: (@Sendable (Float) -> Void)?

    func start(
        captureInput: Bool = true,
        onPCM: (@Sendable (Data) -> Void)? = nil, onLevel: @escaping @Sendable (Float) -> Void,
        onFailure: @escaping @Sendable (String) -> Void,
    ) async throws {
        try await perform {
            guard Self.sessionOwner == nil || Self.sessionOwner === self else { throw AudioError.busy }
            self.stopOnQueue()
            Self.sessionOwner = self
            self.captureInput = captureInput
            self.onLevel = onLevel
            self.onPCM = onPCM
            self.onFailure = onFailure
            do { try self.startOnQueue() } catch {
                self.stopOnQueue()
                throw error
            }
        }
    }

    private func startOnQueue() throws {
        muted.withLock { $0 = false }
        let session = AVAudioSession.sharedInstance()
        if captureInput {
            #if targetEnvironment(simulator)
                try session.setCategory(.playAndRecord, mode: .default)
            #else
                try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP])
            #endif
            try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        } else {
            try session.setCategory(.playback, mode: .spokenAudio)
        }
        try session.setActive(true)
        sessionActive = true
        #if !targetEnvironment(simulator)
            if captureInput { try session.overrideOutputAudioPort(.speaker) }
        #endif
        let engine = AVAudioEngine()
        self.engine = engine
        _ = engine.outputNode
        if captureInput {
            #if !targetEnvironment(simulator)
                try engine.inputNode.setVoiceProcessingEnabled(true)
            #endif
            try installMicrophoneTap()
        }
        let player = AVAudioPlayerNode()
        self.player = player
        engine.attach(player)
        try engine.connectNode(player, to: engine.mainMixerNode, format: playbackFormat)
        // VoiceProcessingIO requires matching capture and output formats.
        try engine.connectNode(
            engine.mainMixerNode, to: engine.outputNode,
            format: captureInput ? engine.inputNode.outputFormat(forBus: 0) : engine.outputNode.inputFormat(forBus: 0), )
        let currentGeneration = generation
        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil,
        ) { [weak self] _ in
            self?.queue.async { [weak self] in
                guard let self, self.generation == currentGeneration else { return }
                do { try self.recoverConfigurationChange() } catch {
                    self.onFailure?("Couldn't restart audio after an audio route change. Please try again.")
                }
            }
        }
        try installPlaybackMeter()
        engine.prepare()
        try engine.start()
        try player.playAudio()
        if !captureInput {
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now(), repeating: .milliseconds(100))
            let silence = Data(count: 4800)
            timer.setEventHandler { [weak self] in self?.onPCM?(silence) }
            silenceTimer = timer
            timer.resume()
        }
        diagnose(
            "Audio started: engine=\(engine.isRunning), player=\(player.isPlaying), capture=\(captureInput), outputRate=\(engine.outputNode.inputFormat(forBus: 0).sampleRate), route=\(session.currentRoute.outputs.map(\.portType.rawValue).joined(separator: ",")), volume=\(session.outputVolume)"
        )
    }

    // Measure rendered output, not the arrival time of network packets.
    private func installPlaybackMeter() throws {
        guard let engine, let onLevel else { return }
        let format = engine.mainMixerNode.outputFormat(forBus: 0)
        let lastLevel = OSAllocatedUnfairLock(initialState: Float(-1))
        try engine.mainMixerNode.__installTap(onBus: 0, bufferSize: 1024, format: format, error: ()) { buffer, _ in
            guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
            let values = UnsafeBufferPointer(start: samples, count: Int(buffer.frameLength))
            let level = min(1, vDSP.rootMeanSquare(values) * 6)
            let changed = lastLevel.withLock { previous in
                guard previous != level else { return false }
                previous = level
                return true
            }
            if changed { onLevel(level) }
        }
    }

    private func installMicrophoneTap() throws {
        guard let engine else { throw AudioError.unavailable }
        let onPCM = onPCM
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0,
            let wireFormat = AVAudioFormat(
                commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: false, ),
            let converter = AVAudioConverter(from: inputFormat, to: wireFormat)
        else {
            throw AudioError.unavailable
        }
        let muteGate = muted
        try input.__installTap(onBus: 0, bufferSize: 2048, format: inputFormat, error: ()) { buffer, _ in
            guard let onPCM else { return }
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 24_000 / inputFormat.sampleRate) + 32
            guard let output = AVAudioPCMBuffer(pcmFormat: wireFormat, frameCapacity: capacity) else { return }
            var supplied = false
            var conversionError: NSError?
            converter.convert(to: output, error: &conversionError) { _, status in
                if supplied {
                    status.pointee = .noDataNow
                    return nil
                }
                supplied = true
                status.pointee = .haveData
                return buffer
            }
            guard conversionError == nil, output.frameLength > 0, let samples = output.int16ChannelData?[0] else {
                return
            }
            let count = Int(output.frameLength) * 2
            onPCM(muteGate.withLock { $0 } ? Data(count: count) : Data(bytes: samples, count: count))
        }
    }

    private func recoverConfigurationChange() throws {
        guard let engine, let player, !engine.isRunning else { return }
        diagnose("Recovering stopped audio engine after hardware format change.")
        // Invalidate callbacks from the old player timeline before stopping it. Keep
        // unplayed buffers so an initial route change cannot discard the greeting.
        playbackGeneration = UUID()
        player.stop()
        if captureInput { engine.inputNode.removeTap(onBus: 0) }
        engine.mainMixerNode.removeTap(onBus: 0)
        if captureInput { try installMicrophoneTap() }
        try engine.connectNode(
            engine.mainMixerNode, to: engine.outputNode,
            format: captureInput ? engine.inputNode.outputFormat(forBus: 0) : engine.outputNode.inputFormat(forBus: 0), )
        try installPlaybackMeter()
        engine.prepare()
        try engine.start()
        for pending in pendingAudio { schedule(pending) }
        try player.playAudio()
        diagnose(
            "Audio recovered: engine=\(engine.isRunning), capture=\(captureInput), outputRate=\(engine.outputNode.inputFormat(forBus: 0).sampleRate)"
        )
    }

    func play(_ data: Data) async throws {
        try await perform { try self.playOnQueue(data) }
    }

    private func playOnQueue(_ data: Data) throws {
        guard data.count.isMultiple(of: 2), !data.isEmpty, let player else { return }
        let frames = data.count / 2
        // Fail rather than let a stalled output build an unbounded, delayed conversation.
        guard queuedFrames + frames < 24_000 * 8 else {
            diagnose(
                "Playback stalled: engine=\(self.engine?.isRunning ?? false), player=\(player.isPlaying), queued=\(self.queuedFrames), completed=\(self.completedFrames), renderTime=\(player.lastRenderTime?.sampleTime ?? -1)"
            )
            throw AudioError.backlog
        }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frames)),
            let samples = buffer.floatChannelData?[0]
        else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        data.withUnsafeBytes { bytes in
            for index in 0..<frames {
                let sample =
                    Float(Int16(littleEndian: bytes.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32768
                samples[index] = sample
            }
        }
        queuedFrames += frames
        let level = min(1, vDSP.rootMeanSquare(UnsafeBufferPointer(start: samples, count: frames)) * 6)
        let pending = PendingAudio(buffer: buffer, audible: level > 0.04)
        pendingAudio.append(pending)
        schedule(pending)
    }

    private func schedule(_ pending: PendingAudio) {
        let currentGeneration = playbackGeneration
        let frames = Int(pending.buffer.frameLength)
        player?.scheduleBuffer(pending.buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            self?.queue.async { [weak self] in
                guard let self, self.playbackGeneration == currentGeneration else { return }
                self.pendingAudio.removeAll { $0.id == pending.id }
                if self.completedFrames == 0 { self.diagnose("First audio buffer played back.") }
                if pending.audible {
                    self.lastAudiblePlayback = (pending.enqueuedAt, .now)
                }
                self.completedFrames += frames
                self.queuedFrames = max(0, self.queuedFrames - frames)
            }
        }
    }

    /// Playback completion, not packet arrival: allow a spoken farewell to finish.
    func farewellFinished(after requestedAt: Date) async -> Bool {
        await withCheckedContinuation { continuation in
            queue.async {
                let finished =
                    self.lastAudiblePlayback.map {
                        $0.enqueuedAt >= requestedAt && Date.now.timeIntervalSince($0.finishedAt) >= 0.8
                    } ?? false
                continuation.resume(returning: finished && !self.pendingAudio.contains(where: \.audible))
            }
        }
    }

    func setMuted(_ muted: Bool) {
        self.muted.withLock { $0 = muted }
        queue.async {
            #if !targetEnvironment(simulator)
                if self.captureInput { self.engine?.inputNode.isVoiceProcessingInputMuted = muted }
            #endif
        }
    }

    func setSpeaker(_ enabled: Bool) async throws {
        try await perform {
            guard Self.sessionOwner === self else { throw AudioError.unavailable }
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none)
        }
    }

    func stop() { queue.async { self.stopOnQueue() } }

    private func stopOnQueue() {
        if completedFrames > 0 {
            diagnose("Audio stopped: playedFrames=\(self.completedFrames), queuedFrames=\(self.queuedFrames)")
        }
        completedFrames = 0
        generation = UUID()
        playbackGeneration = UUID()
        if let configurationObserver { NotificationCenter.default.removeObserver(configurationObserver) }
        configurationObserver = nil
        silenceTimer?.setEventHandler {}
        silenceTimer?.cancel()
        silenceTimer = nil
        onPCM = nil
        onFailure = nil
        pendingAudio.removeAll()
        lastAudiblePlayback = nil
        player?.stop()
        engine?.mainMixerNode.removeTap(onBus: 0)
        if captureInput { engine?.inputNode.removeTap(onBus: 0) }
        engine?.stop()
        engine = nil
        player = nil
        queuedFrames = 0
        onLevel = nil
        if Self.sessionOwner === self {
            // Ownership is reserved before activation, which can fail during setup.
            if sessionActive {
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                sessionActive = false
            }
            Self.sessionOwner = nil
        }
    }

    private func diagnose(_ message: String) {
        logger.notice("\(message, privacy: .public)")
    }

    private func perform(_ work: @escaping @Sendable () throws -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    try work()
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    enum AudioError: LocalizedError {
        case unavailable, backlog, busy
        var errorDescription: String? {
            switch self {
            case .unavailable: "The microphone is unavailable. Check your audio device and try again."
            case .busy: "Audio is already in use in another window. End that call or preview first."
            case .backlog: "Audio playback fell behind. Please start a new call."
            }
        }
    }
}
