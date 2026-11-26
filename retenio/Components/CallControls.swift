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

/// Morphs side controls behind an anchored call button without sharing its tint.
struct CallControlGroup<Content: View, Primary: View>: View {
    var showOrigin = true
    let connected: Bool
    @ViewBuilder var content: (Namespace.ID) -> Content
    @ViewBuilder var primary: (CGFloat) -> Primary
    @Environment(\.controlSize) private var controlSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var glassNamespace

    var body: some View {
        GeometryReader { geometry in
            let buttonWidths = controlSize == .small ? 160.0 : 230.0
            let rowWidth = min(geometry.size.width, buttonWidths + 52)
            let gap = max(8, (rowWidth - buttonWidths) / 2)
            ZStack {
                GlassEffectContainer(spacing: gap) {
                    ZStack {
                        // Neutral morph source, covered by the real call button in its own glass container.
                        if showOrigin {
                            Color.clear
                                .frame(width: controlSize == .small ? 64 : 90, height: controlSize == .small ? 64 : 90)
                                .glassEffect(.clear, in: .circle)
                                .glassEffectID("origin", in: glassNamespace)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                        content(glassNamespace)
                    }
                }
                GlassEffectContainer {
                    primary(rowWidth)
                }
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
    var permissionTitle: String? = nil
    var expandedWidth: CGFloat = 282
    let action: () -> Void
    @State private var feedbackTrigger = false
    @Environment(\.controlSize) private var controlSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let diameter: CGFloat = controlSize == .small ? 64 : 90
        let needsPermission = permissionTitle != nil
        Button {
            feedbackTrigger.toggle()
            action()
        } label: {
            Color.clear.overlay {
                ZStack {
                    Text(permissionTitle ?? "Allow Microphone")
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .frame(width: max(0, expandedWidth - 40))
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(needsPermission ? 1 : 0)
                    Image(systemName: "phone.fill")
                        .font(.system(size: controlSize == .small ? 26 : 31, weight: .semibold))
                        .rotationEffect(.degrees(active ? 135 : 0))
                        .opacity(needsPermission ? 0 : 1)
                }
                .foregroundStyle(.white)
            }
            .clipped()
            .accessibilityHidden(true)
        }
        .buttonStyle(
            .glass(.clear.tint((active ? RetenioTheme.hangup : RetenioTheme.call).opacity(needsPermission ? 0 : RetenioTheme.callTintStrength)))
        )
        // A capsule becomes a circle when its width reaches its height; the button keeps its identity.
        .buttonBorderShape(.capsule)
        .frame(width: needsPermission ? expandedWidth : diameter, height: diameter)
        .animation(reduceMotion ? nil : .smooth(duration: 0.45), value: needsPermission)
        .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: active)
        .sensoryFeedback(.impact(weight: .light), trigger: feedbackTrigger)
        .disabled(disabled)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(permissionTitle ?? (active ? "End call" : "Start call"))
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
    @State private var feedbackTrigger = false
    @Environment(\.controlSize) private var controlSize
    @Namespace private var glassNamespace

    var body: some View {
        let selectedColor: Color = title == "Mute" ? RetenioTheme.muted : .black
        ZStack {
            if visible {
                Button {
                    feedbackTrigger.toggle()
                    action()
                } label: {
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
        .sensoryFeedback(.impact(weight: .light), trigger: feedbackTrigger)
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
                CallControl(symbol: "mic.slash.fill", title: "Mute", visible: connected, namespace: namespace) {}
            }
        } primary: { _ in
            CallToggleButton(active: true, disabled: false) { connected.toggle() }
        }
        .frame(width: 320)
        Button(connected ? "Hide Controls" : "Show Controls") { connected.toggle() }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}

#Preview("Permission to Call — iPhone") {
    @Previewable @State var ready = false
    CallToggleButton(active: false, disabled: false, permissionTitle: ready ? nil : "Allow Microphone") {
        ready.toggle()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
}
