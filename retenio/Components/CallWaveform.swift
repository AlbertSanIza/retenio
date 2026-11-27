import SwiftUI

/// Isolate high-frequency level observation from the surrounding screen layout.
struct CallWaveform: View {
    let call: LiveCall
    var body: some View {
        CallDots(
            active: call.phase == .connected, tint: RetenioTheme.accent,
            level: call.phase == .connected ? call.level : 0,
        )
    }
}
