import AVFoundation
import Combine
import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var call = CallPresentation()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(phase: CallPresentation.Phase = .idle) {
        _call = State(initialValue: CallPresentation(phase: phase))
    }

    var body: some View {
        let isConnected = call.phase == .connected
        CallCanvas { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let headerHeight = min(128, height * 0.4)
            let visualHeight = min(140, max(0, height - headerHeight))
            let voiceY = min(height - visualHeight / 2, max(headerHeight + visualHeight / 2, height * 0.43))
            let titleScale = min(1, min(width / 340, headerHeight / 128))
            ZStack {
                RetenioWordmark(size: 72)
                    .scaleEffect(titleScale * (call.isActive ? 2.0 / 3 : 1))
                    .position(x: width / 2, y: call.isActive ? headerHeight * 0.45 : voiceY)
                    .animation(reduceMotion ? nil : .smooth(duration: 0.55), value: call.isActive)
                Text("00:00")
                    .monospacedDigit()
                    .foregroundStyle(RetenioTheme.accent)
                    .position(x: width / 2, y: headerHeight * 0.85)
                    .opacity(isConnected ? 1 : 0)
                    .animation(.easeInOut(duration: 0.2), value: isConnected)
                    .accessibilityHidden(!isConnected)
                CallVisual(active: call.isActive, connected: isConnected, tint: RetenioTheme.accent) {
                    CallDots(active: isConnected, tint: RetenioTheme.accent, level: isConnected ? call.level : 0)
                }
                .frame(width: 240, height: 140)
                .scaleEffect(min(width / 280, visualHeight / 140))
                .position(x: width / 2, y: voiceY)
            }
        } controls: {
            CallControlGroup(connected: isConnected) { namespace in
                HStack(spacing: 0) {
                    CallControl(
                        symbol: "speaker.wave.2.fill", title: "Audio",
                        selected: call.isSpeaker, visible: isConnected, namespace: namespace,
                    ) {
                        call.toggleSpeaker()
                    }
                    Spacer(minLength: 8)
                    CallToggleButton(active: call.isActive, disabled: false, action: call.toggleCall)
                        .glassEffectID("call", in: namespace)
                        .accessibilityLabel(call.phase == .connecting ? "Cancel call" : (call.isActive ? "End call" : "Start call"))
                    Spacer(minLength: 8)
                    CallControl(
                        symbol: "mic.slash.fill", title: "Mute", selected: call.isMuted, visible: isConnected, namespace: namespace,
                    ) {
                        call.toggleMute()
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, phase in if phase == .background { call.end() } }
        .onReceive(
            NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification).receive(on: RunLoop.main)
        ) { notification in
            if let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                AVAudioSession.InterruptionType(rawValue: raw) == .began
            {
                call.end()
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: AVAudioSession.mediaServicesWereResetNotification).receive(
                on: RunLoop.main)
        ) { _ in call.end() }
        .onReceive(
            NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)
        ) { notification in
            if let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable
            {
                call.end()
            }
        }
        .alert(
            "Audio unavailable",
            isPresented: Binding(get: { call.errorMessage != nil }, set: { if !$0 { call.errorMessage = nil } }),
        ) {
            Button("OK") { call.errorMessage = nil }
        } message: {
            Text(call.errorMessage ?? "")
        }
    }
}

#Preview("Ready") { ContentView() }

#Preview("Connecting") { ContentView(phase: .connecting) }

#Preview("Connected") { ContentView(phase: .connected) }
