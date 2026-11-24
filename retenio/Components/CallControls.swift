import SwiftUI

struct CallBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [RetenioTheme.backgroundTop, RetenioTheme.backgroundBottom],
                startPoint: .topLeading, endPoint: .bottomTrailing, )
            RadialGradient(
                colors: [RetenioTheme.accent.opacity(0.16), .clear], center: .topLeading, startRadius: 0, endRadius: 650, )
        }
        .ignoresSafeArea()
    }
}

/// Coordinates the controls as one glass surface while keeping the center button anchored.
struct CallControlGroup<Content: View>: View {
    let connected: Bool
    @ViewBuilder var content: (Namespace.ID) -> Content
    @Environment(\.controlSize) private var controlSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var glassNamespace

    var body: some View {
        GeometryReader { geometry in
            let buttonWidths = controlSize == .small ? 160.0 : 230.0
            let rowWidth = min(geometry.size.width, buttonWidths + 52)
            let gap = max(8, (rowWidth - buttonWidths) / 2)
            GlassEffectContainer(spacing: gap) {
                content(glassNamespace)
            }
            .frame(width: rowWidth)
            .frame(maxWidth: .infinity)
            .animation(reduceMotion ? nil : .smooth(duration: 0.45), value: connected)
        }
        .frame(height: controlSize == .small ? 64 : 90)
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
        .buttonStyle(
            .glass(.clear.tint((active ? RetenioTheme.hangup : RetenioTheme.call).opacity(RetenioTheme.callTintStrength)))
        )
        .buttonBorderShape(.circle)
        .frame(width: controlSize == .small ? 64 : 90, height: controlSize == .small ? 64 : 90)
        .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: active)
        .sensoryFeedback(.impact(weight: .light), trigger: active)
        .disabled(disabled)
        .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: active)
        .accessibilityLabel(active ? "End call" : "Start call")
        .accessibilityIdentifier("call-toggle")
    }
}

struct CallControl: View {
    var symbol: String
    var title: String
    var selected = false
    var disabled = false
    var visible = true
    var namespace: Namespace.ID? = nil
    var action: () -> Void
    @Environment(\.controlSize) private var controlSize
    @Namespace private var glassNamespace

    var body: some View {
        let selectedColor: Color = title == "Mute" ? RetenioTheme.muted : .black
        ZStack {
            if visible {
                Button(action: action) {
                    Image(systemName: title == "Mute" ? (selected ? "mic.slash.fill" : "mic.fill") : symbol)
                        .font(.system(size: controlSize == .small ? 22 : 26, weight: .medium))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .foregroundStyle(selected ? selectedColor : .white)
                }
                .buttonStyle(.glass(.clear.tint(selected ? RetenioTheme.selectedControl.opacity(RetenioTheme.selectedControlOpacity) : nil)))
                .buttonBorderShape(.circle)
                .glassEffectID(title, in: namespace ?? glassNamespace)
                .glassEffectTransition(.matchedGeometry)
                .disabled(disabled)
                .accessibilityLabel(title)
                .accessibilityValue(
                    title == "Audio" ? (selected ? "Speaker" : "Default route") : (selected ? "Muted" : "Microphone on")
                )
                .accessibilityIdentifier("call-\(title.lowercased())")
            }
        }
        // Reserve the slot so the call button stays anchored as the glass appears and disappears.
        .frame(width: controlSize == .small ? 48 : 70, height: controlSize == .small ? 48 : 70)
        .allowsHitTesting(visible)
        .accessibilityHidden(!visible)
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

#Preview("Controls Appearing") {
    @Previewable @State var connected = false
    VStack(spacing: 48) {
        CallControlGroup(connected: connected) { namespace in
            HStack(spacing: 0) {
                CallControl(symbol: "speaker.wave.2.fill", title: "Audio", selected: true, visible: connected, namespace: namespace) {}
                Spacer(minLength: 8)
                CallToggleButton(active: true, disabled: false) { connected.toggle() }
                    .glassEffectID("call", in: namespace)
                Spacer(minLength: 8)
                CallControl(symbol: "mic.slash.fill", title: "Mute", visible: connected, namespace: namespace) {}
            }
        }
        .frame(width: 320)
        Button(connected ? "Hide Controls" : "Show Controls") { connected.toggle() }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}
