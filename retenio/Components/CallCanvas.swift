import SwiftUI

/// Reserves a bottom control area; only the call's optional details may scroll.
struct CallCanvas<Content: View, Controls: View>: View {
    @ViewBuilder var content: (GeometryProxy) -> Content
    @ViewBuilder var controls: () -> Controls

    var body: some View {
        GeometryReader { viewport in
            let compact = viewport.size.height < 420
            GeometryReader { geometry in
                content(geometry)
            }
            .frame(maxWidth: 600)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                controls()
                    .controlSize(compact ? .small : .regular)
                    .frame(minHeight: compact ? 64 : 112)
                    .frame(maxWidth: 320)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
            }
            // Supply the breathing room that iPhone's status and home-indicator areas provide.
            .padding(.top, max(0, 64 - viewport.safeAreaInsets.top))
            .padding(.bottom, max(0, 34 - viewport.safeAreaInsets.bottom))
        }
        .background { CallBackground() }
    }
}

#Preview("Canvas — iPhone") {
    CallCanvasPreview()
}

#Preview("Canvas — iPad Landscape", traits: .fixedLayout(width: 1194, height: 834)) {
    CallCanvasPreview()
}

#Preview("Canvas — Compact Window", traits: .fixedLayout(width: 320, height: 300)) {
    CallCanvasPreview()
}

private struct CallCanvasPreview: View {
    var body: some View {
        CallCanvas { geometry in
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(RetenioTheme.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [6]))
                .overlay {
                    Text("Content area\n\(Int(geometry.size.width)) × \(Int(geometry.size.height))")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white)
                }
        } controls: {
            HStack {
                CallControl(symbol: "speaker.wave.2.fill", title: "Audio") {}
                Spacer(minLength: 8)
                CallToggleButton(active: true, disabled: false) {}
                Spacer(minLength: 8)
                CallControl(symbol: "mic.slash.fill", title: "Mute") {}
            }
        }
        .preferredColorScheme(.dark)
    }
}
