import SwiftUI

@main
struct RetenioApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var call = LiveCall()

    var body: some Scene {
        WindowGroup {
            ContentView(call: call)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background, call.phase == .connecting { call.end() }
        }
    }
}
