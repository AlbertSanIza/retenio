import SwiftUI

struct CallBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.02, green: 0.34, blue: 0.29), Color(red: 0.01, green: 0.18, blue: 0.16)],
                startPoint: .topLeading, endPoint: .bottomTrailing, )
            RadialGradient(
                colors: [Color.mint.opacity(0.16), .clear], center: .topLeading, startRadius: 0, endRadius: 650, )
        }
        .ignoresSafeArea()
    }
}

struct CallToggleButton: View {
    let active: Bool
    let disabled: Bool
    let action: () -> Void
    @Environment(\.controlSize) private var controlSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Button(action: action) {
            Image(systemName: "phone.fill")
                .font(.system(size: controlSize == .small ? 26 : 31, weight: .semibold))
                .rotationEffect(.degrees(active ? 135 : 0))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .tint(active ? Color(red: 0.93, green: 0.18, blue: 0.27) : Color(red: 0.12, green: 0.76, blue: 0.42))
        .frame(width: controlSize == .small ? 64 : 86, height: controlSize == .small ? 64 : 86)
        .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: active)
        .sensoryFeedback(.impact(weight: .light), trigger: active)
        .disabled(disabled)
        .accessibilityLabel(active ? "End call" : "Start call")
        .accessibilityIdentifier("call-toggle")
    }
}

struct CallControl: View {
    var symbol: String
    var title: String
    var selected = false
    var disabled = false
    var action: () -> Void
    @Environment(\.controlSize) private var controlSize
    var body: some View {
        let selectedColor: Color = title == "Mute" ? Color(red: 1, green: 0.23, blue: 0.19) : .black
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: controlSize == .small ? 22 : 26, weight: .medium))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .foregroundStyle(selected ? selectedColor : .white)
        }
        .buttonStyle(.glass(.regular.tint(selected ? .white : nil)))
        .buttonBorderShape(.circle)
        .frame(width: controlSize == .small ? 48 : 70, height: controlSize == .small ? 48 : 70)
        .disabled(disabled)
        .accessibilityLabel(title)
        .accessibilityValue(
            title == "Audio" ? (selected ? "Speaker" : "Default route") : (selected ? "Muted" : "Microphone on")
        )
        .accessibilityIdentifier("call-\(title.lowercased())")
    }
}

#Preview("Background") {
    CallBackground()
}

#Preview("Call Button") {
    @Previewable @State var active = false
    VStack(spacing: 32) {
        CallToggleButton(active: active, disabled: false) { active.toggle() }
        CallToggleButton(active: active, disabled: false) { active.toggle() }
            .controlSize(.small)
        CallToggleButton(active: active, disabled: true) {}
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
}

#Preview("Audio and Mute Controls") {
    @Previewable @State var speaker = true
    @Previewable @State var muted = false
    VStack(spacing: 32) {
        HStack(spacing: 32) {
            CallControl(symbol: "speaker.wave.2.fill", title: "Audio", selected: speaker) { speaker.toggle() }
            CallControl(symbol: "mic.slash.fill", title: "Mute", selected: muted) { muted.toggle() }
        }
        HStack(spacing: 32) {
            CallControl(symbol: "speaker.wave.2.fill", title: "Audio", selected: speaker) { speaker.toggle() }
            CallControl(symbol: "mic.slash.fill", title: "Mute", selected: muted) { muted.toggle() }
        }
        .controlSize(.small)
        CallControl(symbol: "mic.slash.fill", title: "Mute", disabled: true) {}
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}
