import Foundation
import Observation

/// Presentation-only call state. The next layers connect this screen to real audio.
@MainActor @Observable
final class CallPresentation {
    var isActive = false
    var isMuted = false
    var isSpeaker = true
    var startedAt: Date?

    func toggleCall() {
        isActive.toggle()
        startedAt = isActive ? .now : nil
        isMuted = false
    }
}
