import SwiftUI

/// Keeps the call layout stable, with scrolling when a window is too short.
struct CallCanvas<Content: View>: View {
    @ViewBuilder var content: (CGSize) -> Content

    var body: some View {
        GeometryReader { viewport in
            ScrollView {
                GeometryReader { geometry in
                    content(geometry.size)
                }
                .frame(height: max(viewport.size.height, 620))
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background { CallBackground() }
        }
    }
}
