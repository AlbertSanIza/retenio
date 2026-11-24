import SwiftUI

/// Reserves a bottom control area; only the call's optional details may scroll.
struct CallCanvas<Content: View, Controls: View>: View {
    @ViewBuilder var content: (GeometryProxy) -> Content
    @ViewBuilder var controls: () -> Controls

    var body: some View {
        GeometryReader { geometry in
            content(geometry)
        }
        .frame(maxWidth: 600)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            controls()
                .frame(maxWidth: 320)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
        }
        .background { CallBackground() }
    }
}
