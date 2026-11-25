import SwiftUI

/// Feed audio into the same renderer that handles the connection morph.
struct VoiceVisualizer: View {
    let level: Float
    let active: Bool
    let tint: Color
    let reduceMotion: Bool
    let visible: Bool

    var body: some View {
        CallDots(active: visible, tint: tint, level: active ? level : 0, motionDisabled: reduceMotion)
    }
}

#Preview("Voice Levels") {
    @Previewable @State var level: Float = 0
    VStack(spacing: 32) {
        VoiceVisualizer(level: level, active: true, tint: .mint, reduceMotion: false, visible: true)
            .frame(width: 240, height: 140)
        Slider(value: $level, in: 0...1) { Text("Voice Level") }
            .frame(width: 240)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}
