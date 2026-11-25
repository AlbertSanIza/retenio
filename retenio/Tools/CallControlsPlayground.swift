#if DEBUG
    import SwiftUI

    /// Preview-only call-control tuning. Changes stay local to this playground.
    struct CallControlsPlayground: View {
        private enum Material: String, CaseIterable {
            case regular = "Regular"
            case clear = "Clear"

            var glass: Glass { self == .regular ? .regular : .clear }
        }

        private struct Settings {
            var material = Material.clear
            var prominentCall = false
            var selectedTint = Color.white
            var selectedTintStrength = 0.5
            var tintUnselected = false
            var unselectedTint = Color.white
            var unselectedTintStrength = 0.15
            var callTint = Color(red: 0.93, green: 0.18, blue: 0.27)
            var callTintStrength = 0.9
            var circles = true
            var sideSize = 70.0
            var callSize = 90.0
            var spacing = 26.0
            var detailedBackground = false
        }

        @State private var settings = Settings()
        @State private var speaker = true
        @State private var muted = false
        @State private var showControls = true
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Namespace private var glassNamespace

        var body: some View {
            NavigationStack {
                GeometryReader { geometry in
                    VStack(spacing: 0) {
                        sample.frame(height: min(260, geometry.size.height * 0.38))
                        controls
                    }
                }
                .navigationTitle("Call Controls Playground")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    Button("Reset") {
                        settings = Settings()
                        speaker = true
                        muted = false
                        showControls = true
                    }
                }
            }
            .preferredColorScheme(.dark)
        }

        private var sample: some View {
            GeometryReader { geometry in
                let width = settings.sideSize * 2 + settings.callSize + settings.spacing * 2
                let scale = min(1, max(0, geometry.size.width - 32) / width)
                GlassEffectContainer(spacing: settings.spacing) {
                    HStack(spacing: settings.spacing) {
                        sideButton("speaker.wave.2.fill", title: "Speaker", selected: speaker, color: .black) { speaker.toggle() }
                        callButton
                            .glassEffectID("call", in: glassNamespace)
                        sideButton(muted ? "mic.slash.fill" : "mic.fill", title: "Mute", selected: muted, color: Color(red: 0.65, green: 0.08, blue: 0.12)) {
                            muted.toggle()
                        }
                    }
                }
                .animation(reduceMotion ? nil : .smooth(duration: 0.45), value: showControls)
                .frame(width: width, height: max(settings.sideSize, settings.callSize))
                .scaleEffect(scale)
                .frame(width: geometry.size.width, height: geometry.size.height)
                .background {
                    if settings.detailedBackground {
                        LinearGradient(
                            colors: [.indigo, .pink, .orange, .teal, .blue],
                            startPoint: .topLeading, endPoint: .bottomTrailing,
                        )
                        HStack(spacing: 36) {
                            ForEach(0..<5) { _ in
                                Rectangle().fill(.white.opacity(0.35)).frame(width: 18)
                            }
                        }
                        .clipped()
                    } else {
                        CallBackground()
                    }
                }
                .clipped()
            }
        }

        private var border: ButtonBorderShape { settings.circles ? .circle : .roundedRectangle(radius: 20) }

        private var callButton: some View {
            let button = Button {
                showControls.toggle()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 31, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            return Group {
                if settings.prominentCall {
                    button.buttonStyle(.glassProminent)
                        .tint(settings.callTint.opacity(settings.callTintStrength))
                } else {
                    button.buttonStyle(.glass(settings.material.glass.tint(settings.callTint.opacity(settings.callTintStrength))))
                }
            }
            .buttonBorderShape(border)
            .frame(width: settings.callSize, height: settings.callSize)
            .accessibilityLabel("Toggle Side Buttons")
        }

        private func sideButton(_ symbol: String, title: String, selected: Bool, color: Color, action: @escaping () -> Void) -> some View {
            let tint: Color? =
                selected
                ? settings.selectedTint.opacity(settings.selectedTintStrength)
                : (settings.tintUnselected ? settings.unselectedTint.opacity(settings.unselectedTintStrength) : nil)
            return ZStack {
                if showControls {
                    Button(action: action) {
                        Image(systemName: symbol)
                            .font(.system(size: 26, weight: .medium))
                            .foregroundStyle(selected ? color : .white)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .buttonStyle(.glass(settings.material.glass.tint(tint)))
                    .buttonBorderShape(border)
                    .glassEffectID(title, in: glassNamespace)
                    .glassEffectTransition(.matchedGeometry)
                    .accessibilityLabel(title)
                    .accessibilityValue(selected ? "On" : "Off")
                }
            }
            .frame(width: settings.sideSize, height: settings.sideSize)
            .allowsHitTesting(showControls)
            .accessibilityHidden(!showControls)
        }

        private var controls: some View {
            Form {
                Section("Glass") {
                    Picker("Material", selection: $settings.material) {
                        ForEach(Material.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Toggle("Prominent Call Button", isOn: $settings.prominentCall)
                    Toggle("Detailed Background", isOn: $settings.detailedBackground)
                    Toggle("Show Side Buttons", isOn: $showControls)
                    Text("Tap Speaker or Mute to compare selected states. Tap the call button to preview the morph.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Selected Buttons") {
                    ColorPicker("Tint", selection: $settings.selectedTint, supportsOpacity: false)
                    adjustment("Tint Strength", value: $settings.selectedTintStrength, range: 0...1, percent: true)
                }
                Section("Unselected Buttons") {
                    Toggle("Add Tint", isOn: $settings.tintUnselected)
                    if settings.tintUnselected {
                        ColorPicker("Tint", selection: $settings.unselectedTint, supportsOpacity: false)
                        adjustment("Tint Strength", value: $settings.unselectedTintStrength, range: 0...1, percent: true)
                    }
                }
                Section("Call Button") {
                    ColorPicker("Tint", selection: $settings.callTint, supportsOpacity: false)
                    adjustment("Tint Strength", value: $settings.callTintStrength, range: 0...1, percent: true)
                }
                Section("Shape and Layout") {
                    Toggle("Circular Buttons", isOn: $settings.circles)
                    adjustment("Side Button Size", value: $settings.sideSize, range: 44...100)
                    adjustment("Call Button Size", value: $settings.callSize, range: 64...116)
                    adjustment("Spacing", value: $settings.spacing, range: 8...48)
                }
            }
        }

        private func adjustment(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, percent: Bool = false) -> some View {
            VStack(alignment: .leading) {
                LabeledContent(title) {
                    Text(percent ? "\(Int((value.wrappedValue * 100).rounded()))%" : "\(Int(value.wrappedValue.rounded())) pt")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .accessibilityHidden(true)
                Slider(value: value, in: range, step: percent ? 0.01 : 1) { Text(title) }
                    .accessibilityValue(percent ? "\(Int((value.wrappedValue * 100).rounded())) percent" : "\(Int(value.wrappedValue.rounded())) points")
            }
        }
    }

    #Preview("Call Controls Playground — iPhone") {
        CallControlsPlayground()
    }
#endif
