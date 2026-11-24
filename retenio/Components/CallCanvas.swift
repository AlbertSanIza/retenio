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
