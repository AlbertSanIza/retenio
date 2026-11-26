import AVFoundation
import Foundation
import Observation

/// Local audio demo: permission, capture, mute, routing, and a short playback tone.
@MainActor @Observable
final class CallPresentation {
    enum Phase { case idle, connecting, connected }
    private(set) var phase: Phase
    var isActive: Bool { phase != .idle }
    var isMuted = false
    var isSpeaker = true
    var startedAt: Date?
    var level: Float = 0
    var errorMessage: String?
    private let audio = VoiceAudio()
    private var startTask: Task<Void, Never>?
    private var generation = UUID()

    init(phase: Phase = .idle) {
        self.phase = phase
        startedAt = phase == .connected ? .now : nil
    }

    func toggleCall() {
        if isActive {
            end()
            return
        }
        phase = .connecting
        generation = UUID()
        let id = generation
        startTask = Task { [self] in
            guard await AVAudioApplication.requestRecordPermission() else {
                if generation == id {
                    errorMessage = "Enable microphone access in Settings."
                    end()
                }
                return
            }
            guard generation == id, !Task.isCancelled else { return }
            do {
                try await audio.start(
                    onPCM: { _ in },
                    onLevel: { [weak self] value in
                        Task { @MainActor [weak self] in if self?.generation == id { self?.level = value } }
                    },
                    onFailure: { [weak self] message in
                        Task { @MainActor [weak self] in
                            guard self?.generation == id else { return }
                            self?.errorMessage = message
                            self?.end()
                        }
                    }, )
                guard generation == id, !Task.isCancelled else {
                    audio.stop()
                    return
                }
                phase = .connected
                startedAt = .now
                let samples = (0..<6000).map { index -> Int16 in
                    let envelope = sin(.pi * Double(index) / 6000)
                    return Int16(sin(2 * .pi * 440 * Double(index) / 24000) * 3500 * envelope)
                }
                try await audio.play(samples.withUnsafeBytes { Data($0) })
            } catch {
                guard generation == id else { return }
                errorMessage = error.localizedDescription
                end()
            }
        }
    }

    func toggleMute() {
        guard startedAt != nil else { return }
        isMuted.toggle()
        audio.setMuted(isMuted)
    }
    func toggleSpeaker() {
        isSpeaker.toggle()
        let id = generation
        let enabled = isSpeaker
        Task {
            do { try await audio.setSpeaker(enabled) } catch {
                if generation == id {
                    isSpeaker = !enabled
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
    func end() {
        generation = UUID()
        startTask?.cancel()
        startTask = nil
        audio.stop()
        phase = .idle
        startedAt = nil
        level = 0
        isMuted = false
        isSpeaker = true
    }
}
