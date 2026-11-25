import Foundation
import Observation

/// Presentation-only call state. The next layers connect this screen to real audio.
@MainActor @Observable
final class CallPresentation {
    enum Phase { case idle, connecting, connected }
    private(set) var phase: Phase
    var isActive: Bool { phase != .idle }
    var isMuted = false
    var isSpeaker = true
    private(set) var startedAt: Date?

    init(phase: Phase = .idle) {
        self.phase = phase
        startedAt = phase == .connected ? .now : nil
    }

    func toggleCall() {
        phase = isActive ? .idle : .connecting
        startedAt = nil
        isMuted = false
    }

    func connected() {
        guard phase == .connecting else { return }
        phase = .connected
        startedAt = .now
    }
}
