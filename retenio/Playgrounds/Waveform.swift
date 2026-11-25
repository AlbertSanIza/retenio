#if DEBUG
    import SwiftUI

    /// Preview-only waveform tuning. Changes stay local to this playground.
    struct CallWaveformPlayground: View {
        @State private var active = true
        @State private var connected = false
        @State private var clearGlass = true
        @State private var tintStrength = RetenioTheme.waveformTintStrength
        @State private var gradientStrength = RetenioTheme.waveformGradientStrength
        @State private var level = 0.0
        @State private var still = false

        private var glass: Glass { clearGlass ? .clear : .regular }

        var body: some View {
            ScrollView {
                VStack(spacing: 24) {
                    Text("Call Waveform Playground").font(.largeTitle.bold())
                    VStack(spacing: 24) { comparisons }
                    HStack {
                        Button(active ? "End" : "Start") {
                            active.toggle()
                            connected = false
                        }
                        .accessibilityIdentifier("preview.start-end")
                        Button("Connect") { connected = true }
                            .disabled(!active || connected)
                            .accessibilityIdentifier("preview.connect")
                    }
                    .buttonStyle(.glass)
                    VStack(alignment: .leading, spacing: 20) {
                        Toggle("Clear Glass", isOn: $clearGlass)
                        Toggle("Still Preview", isOn: $still)
                        percentageSlider("Tint Strength", value: $tintStrength)
                        percentageSlider("Gradient Strength", value: $gradientStrength)
                        percentageSlider("Simulated Voice Level", value: $level)
                    }
                    .frame(maxWidth: 400)
                }
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .background { CallBackground() }
            .preferredColorScheme(.dark)
        }

        private func percentageSlider(_ title: String, value: Binding<Double>) -> some View {
            VStack(alignment: .leading, spacing: 8) {
                LabeledContent(title) {
                    Text(value.wrappedValue, format: .percent.precision(.fractionLength(0)))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .font(.headline)
                .accessibilityHidden(true)
                Slider(value: value, in: 0...1, step: 0.01) { Text(title) }
                    .accessibilityValue(value.wrappedValue.formatted(.percent.precision(.fractionLength(0))))
            }
        }

        @ViewBuilder
        private var comparisons: some View {
            sample("Original Shading", glass: nil)
            sample("Liquid Glass", glass: glass)
        }

        private func sample(_ title: String, glass: Glass?) -> some View {
            VStack(spacing: 8) {
                Text(title).font(.headline)
                CallVisual(active: active, connected: connected, tint: RetenioTheme.accent) {
                    CallDots(
                        active: connected, tint: RetenioTheme.accent, level: Float(level), motionDisabled: still, glass: glass, glassTintStrength: tintStrength,
                        glassGradientStrength: gradientStrength, )
                }
                .frame(width: 240, height: 140)
            }
        }
    }

    #Preview("Call Waveform Playground — iPhone") {
        CallWaveformPlayground()
    }
#endif
