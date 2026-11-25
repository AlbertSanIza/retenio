import SwiftUI

@main
struct RetenioApp: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--glass-waveform-preview") {
                    GlassWaveformPreview()
                } else {
                    ContentView()
                }
            #else
                ContentView()
            #endif
        }
    }
}
