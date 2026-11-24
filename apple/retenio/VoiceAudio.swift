@preconcurrency import AVFoundation
import Foundation
import os

// AVAudioEngine and AVAudioSession are confined to this serial queue. Hardware setup
// must not block the main actor (voice-processing initialization can wait on system RPC).
nonisolated final class VoiceAudio: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.albertsaniza.retenio.audio", qos: .userInitiated)
    private let muted = OSAllocatedUnfairLock(initialState: false)
    #if DEBUG
    private let capturedFrames = OSAllocatedUnfairLock(initialState: 0)
    #endif
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
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
        let buffer: AVAudioPCMBuffer
        let audible: Bool
    }
    private var pendingAudio: [PendingAudio] = []
    private var lastAudiblePlayback: Date?
    private let playbackFormat = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!
    private var onLevel: (@Sendable (Float) -> Void)?

    func start(onPCM: @escaping @Sendable (Data) -> Void, onLevel: @escaping @Sendable (Float) -> Void, onFailure: @escaping @Sendable (String) -> Void) async throws {
        try await perform {
            self.stopOnQueue()
            self.onLevel = onLevel
            self.onPCM = onPCM
            self.onFailure = onFailure
            try self.startOnQueue()
        }
    }

    private func startOnQueue() throws {
        muted.withLock { $0 = false }
        let session = AVAudioSession.sharedInstance()
        #if targetEnvironment(simulator)
        // The simulator uses the Mac's audio devices, not iPhone voice-processing routes.
        try session.setCategory(.playAndRecord, mode: .default)
        #else
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP])
        #endif
        try session.setActive(true)
        #if !targetEnvironment(simulator)
        try session.overrideOutputAudioPort(.speaker)
        #endif
        let engine = AVAudioEngine()
        self.engine = engine
        // Create both I/O nodes before switching their shared audio unit to voice processing.
        _ = engine.outputNode
        let input = engine.inputNode
        #if !targetEnvironment(simulator)
        try input.setVoiceProcessingEnabled(true)
        #endif
        try installMicrophoneTap()
        let player = AVAudioPlayerNode()
        self.player = player
        engine.attach(player)
        try engine.connectNode(player, to: engine.mainMixerNode, format: playbackFormat)
        // VoiceProcessingIO requires matching capture and output formats.
        try engine.connectNode(engine.mainMixerNode, to: engine.outputNode,
                               format: input.outputFormat(forBus: 0))
        let currentGeneration = generation
        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { [weak self] _ in
            self?.queue.async { [weak self] in
                guard let self, self.generation == currentGeneration else { return }
                do { try self.recoverConfigurationChange() }
                catch { self.onFailure?("Couldn't restart audio after an audio route change. Please try again.") }
            }
        }
        engine.prepare()
        try engine.start()
        try player.playAudio()
        diagnose("Audio started: engine=\(engine.isRunning), player=\(player.isPlaying), inputRate=\(input.outputFormat(forBus: 0).sampleRate), outputRate=\(engine.outputNode.inputFormat(forBus: 0).sampleRate), route=\(session.currentRoute.outputs.map(\.portType.rawValue).joined(separator: ",")), volume=\(session.outputVolume)")
    }

    private func installMicrophoneTap() throws {
        guard let engine, let onPCM else { throw AudioError.unavailable }
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0,
              let wireFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: inputFormat, to: wireFormat) else {
            throw AudioError.unavailable
        }
        let muteGate = muted
        #if DEBUG
        let capturedFrames = capturedFrames
        #endif
        try input.__installTap(onBus: 0, bufferSize: 2048, format: inputFormat, error: ()) { buffer, _ in
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 24_000 / inputFormat.sampleRate) + 32
            guard let output = AVAudioPCMBuffer(pcmFormat: wireFormat, frameCapacity: capacity) else { return }
            var supplied = false
            var conversionError: NSError?
            converter.convert(to: output, error: &conversionError) { _, status in
                if supplied { status.pointee = .noDataNow; return nil }
                supplied = true
                status.pointee = .haveData
                return buffer
            }
            guard conversionError == nil, output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
            #if DEBUG
            capturedFrames.withLock { $0 += Int(output.frameLength) }
            #endif
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
        engine.inputNode.removeTap(onBus: 0)
        try installMicrophoneTap()
        try engine.connectNode(engine.mainMixerNode, to: engine.outputNode,
                               format: engine.inputNode.outputFormat(forBus: 0))
        engine.prepare()
        try engine.start()
        for pending in pendingAudio { schedule(pending) }
        try player.playAudio()
        diagnose("Audio recovered: engine=\(engine.isRunning), inputRate=\(engine.inputNode.outputFormat(forBus: 0).sampleRate), outputRate=\(engine.outputNode.inputFormat(forBus: 0).sampleRate)")
    }

    func play(_ data: Data) async throws {
        try await perform { try self.playOnQueue(data) }
    }

    private func playOnQueue(_ data: Data) throws {
        guard data.count.isMultiple(of: 2), !data.isEmpty, let player else { return }
        let frames = data.count / 2
        // Fail rather than let a stalled output build an unbounded, delayed conversation.
        guard queuedFrames + frames < 24_000 * 8 else {
            diagnose("Playback stalled: engine=\(self.engine?.isRunning ?? false), player=\(player.isPlaying), queued=\(self.queuedFrames), completed=\(self.completedFrames), renderTime=\(player.lastRenderTime?.sampleTime ?? -1)")
            throw AudioError.backlog
        }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frames)),
              let samples = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        var power: Float = 0
        data.withUnsafeBytes { bytes in
            for index in 0..<frames {
                let sample = Float(Int16(littleEndian: bytes.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32768
                samples[index] = sample
                power += sample * sample
            }
        }
        let level = min(1, sqrt(power / Float(frames)) * 6)
        queuedFrames += frames
        onLevel?(level)
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
                if pending.audible { self.lastAudiblePlayback = .now }
                self.completedFrames += frames
                self.queuedFrames = max(0, self.queuedFrames - frames)
                if self.queuedFrames == 0 { self.onLevel?(0) }
            }
        }
    }

    /// Playback completion, not packet arrival: allow a spoken farewell to finish.
    func farewellFinished(after requestedAt: Date) async -> Bool {
        await withCheckedContinuation { continuation in
            queue.async {
                let finished = self.lastAudiblePlayback.map {
                    $0 >= requestedAt.addingTimeInterval(-2) && Date.now.timeIntervalSince($0) >= 0.8
                } ?? false
                continuation.resume(returning: finished && !self.pendingAudio.contains(where: \.audible))
            }
        }
    }

    func setMuted(_ muted: Bool) {
        self.muted.withLock { $0 = muted }
        queue.async {
            #if !targetEnvironment(simulator)
            self.engine?.inputNode.isVoiceProcessingInputMuted = muted
            #endif
        }
    }

    func setSpeaker(_ enabled: Bool) async throws {
        try await perform {
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none)
        }
    }

    func stop() { queue.async { self.stopOnQueue() } }

    private func stopOnQueue() {
        if completedFrames > 0 { diagnose("Audio stopped: playedFrames=\(self.completedFrames), queuedFrames=\(self.queuedFrames)") }
        completedFrames = 0
        #if DEBUG
        capturedFrames.withLock { $0 = 0 }
        #endif
        generation = UUID()
        playbackGeneration = UUID()
        if let configurationObserver { NotificationCenter.default.removeObserver(configurationObserver) }
        configurationObserver = nil
        onPCM = nil
        onFailure = nil
        pendingAudio.removeAll()
        lastAudiblePlayback = nil
        player?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        player = nil
        queuedFrames = 0
        onLevel?(0)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    #if DEBUG
    func verifyPlaybackForTesting() async -> Bool {
        await withCheckedContinuation { continuation in
            queue.async {
                let captured = self.capturedFrames.withLock { $0 }
                let running = self.engine?.isRunning == true
                let passed = running && captured > 24_000 && self.completedFrames > 24_000
                    && self.queuedFrames < 24_000 * 2
                self.diagnose("Playback check: running=\(running), capturedFrames=\(captured), playedFrames=\(self.completedFrames), queuedFrames=\(self.queuedFrames), passed=\(passed)")
                continuation.resume(returning: passed)
            }
        }
    }
    #endif

    private func diagnose(_ message: String) {
        logger.notice("\(message, privacy: .public)")
        #if DEBUG
        print("VoiceAudio: \(message)")
        #endif
    }

    private func perform(_ work: @escaping @Sendable () throws -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do { try work(); continuation.resume() }
                catch { continuation.resume(throwing: error) }
            }
        }
    }

    enum AudioError: LocalizedError {
        case unavailable, backlog
        var errorDescription: String? {
            switch self {
            case .unavailable: "The microphone is unavailable. Check your audio device and try again."
            case .backlog: "Audio playback fell behind. Please start a new call."
            }
        }
    }
}
