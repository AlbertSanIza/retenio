import AVFoundation
import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    let call: LiveCall
    @Environment(\.openURL) private var openURL
    @State private var microphonePermission: AVAudioApplication.recordPermission
    @State private var requestingMicrophone = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        call: LiveCall,
        microphonePermission: AVAudioApplication.recordPermission = AVAudioApplication.shared.recordPermission,
    ) {
        self.call = call
        _microphonePermission = State(initialValue: microphonePermission)
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
                    .scaleEffect(titleScale * (call.isPresentingCall ? 2.0 / 3 : 1))
                    .position(x: width / 2, y: call.isPresentingCall ? headerHeight * 0.45 : voiceY)
                    .animation(reduceMotion ? nil : .smooth(duration: 0.55), value: call.isPresentingCall)
                (call.startedAt.map { Text($0, style: .timer) } ?? Text("00:00"))
                    .monospacedDigit()
                    .foregroundStyle(RetenioTheme.accent)
                    .position(x: width / 2, y: headerHeight * 0.85)
                    .opacity(isConnected ? 1 : 0)
                    .animation(.easeInOut(duration: 0.2), value: isConnected)
                    .accessibilityHidden(!isConnected)
                CallVisual(active: call.phase == .connecting || isConnected, connected: isConnected) {
                    CallWaveform(call: call)
                }
                .frame(width: 240, height: 140)
                .scaleEffect(min(width / 280, visualHeight / 140))
                .position(x: width / 2, y: voiceY)
            }
        } controls: {
            CallControlGroup(showOrigin: permissionTitle == nil, connected: isConnected) { namespace in
                HStack {
                    CallControl(
                        symbol: "speaker.wave.2.fill", title: "Audio",
                        selected: call.isSpeaker, visible: isConnected, namespace: namespace,
                    ) { call.toggleSpeaker() }
                    Spacer(minLength: 8)
                    CallControl(
                        symbol: "mic.slash.fill", title: "Mute", selected: call.isMuted,
                        visible: isConnected, namespace: namespace,
                    ) { call.toggleMute() }
                }
            } primary: { width in
                CallToggleButton(
                    active: call.isPresentingCall, disabled: requestingMicrophone || call.phase == .ending,
                    permissionTitle: permissionTitle, expandedWidth: width, action: performPrimaryAction,
                )
                .accessibilityLabel(permissionTitle ?? (call.phase == .connecting ? "Cancel call" : (call.isPresentingCall ? "End call" : "Start call")))
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.45), value: microphonePermission)
        .preferredColorScheme(.dark)
        .task(id: requestingMicrophone) {
            guard requestingMicrophone else { return }
            _ = await AVAudioApplication.requestRecordPermission()
            microphonePermission = AVAudioApplication.shared.recordPermission
            requestingMicrophone = false
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { microphonePermission = AVAudioApplication.shared.recordPermission }
        }
        .alert(
            "Audio unavailable",
            isPresented: Binding(get: { call.errorMessage != nil }, set: { if !$0 { call.errorMessage = nil } }),
        ) {
            Button("OK") {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                call.errorMessage = nil
            }
        } message: {
            Text(call.errorMessage ?? "")
        }
    }
    private var permissionTitle: String? {
        guard !call.isPresentingCall, microphonePermission != .granted else { return nil }
        return microphonePermission == .denied ? "Open Microphone Settings" : "Allow Microphone"
    }

    private func performPrimaryAction() {
        if call.isPresentingCall {
            call.end()
            return
        }
        let permission = AVAudioApplication.shared.recordPermission
        guard permission == microphonePermission else {
            microphonePermission = permission
            return
        }
        switch permission {
        case .granted:
            call.start()
        case .denied:
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        default:
            requestingMicrophone = true
        }
    }
}

#Preview("Ready") { ContentView(call: LiveCall(), microphonePermission: .granted) }

#Preview("Allow Microphone") { ContentView(call: LiveCall(), microphonePermission: .undetermined) }

#Preview("Microphone Denied") { ContentView(call: LiveCall(), microphonePermission: .denied) }
