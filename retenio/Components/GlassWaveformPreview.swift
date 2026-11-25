#if DEBUG
    import SwiftUI

    /// A local experiment: compare materials without changing the call screen.
    struct GlassWaveformPreview: View {
        @State private var active = true
        @State private var connected = false
        @State private var clearGlass = false
        @State private var tintStrength = 0.35
        @State private var gradientStrength = 0.5
        @State private var level = 0.0
        @State private var still = false

        private var glass: Glass { (clearGlass ? Glass.clear : Glass.regular).tint(.mint.opacity(tintStrength)) }

        var body: some View {
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 24) {
                        Text("Glass Waveforms").font(.largeTitle.bold())
                        if geometry.size.width > 650 {
                            HStack(spacing: 40) { comparisons }
                        } else {
                            VStack(spacing: 24) { comparisons }
                        }
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
            sample("Current", glass: nil)
            sample("Liquid Glass", glass: glass)
        }

        private func sample(_ title: String, glass: Glass?) -> some View {
            VStack(spacing: 8) {
                Text(title).font(.headline)
                CallVisual(active: active, connected: connected, tint: .mint) {
                    CallDots(active: connected, tint: .mint, level: Float(level), motionDisabled: still, glass: glass, glassGradientStrength: gradientStrength)
                }
                .frame(width: 240, height: 140)
            }
        }
    }

    #Preview("Glass Waveforms — iPhone") {
        GlassWaveformPreview()
    }

    #Preview("Glass Waveforms — iPad", traits: .fixedLayout(width: 1194, height: 834)) {
        GlassWaveformPreview()
    }

    #Preview("Glass Waveforms — Small Window", traits: .fixedLayout(width: 400, height: 360)) {
        GlassWaveformPreview()
    }
#endif
