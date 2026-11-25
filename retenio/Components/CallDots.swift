import SwiftUI

/// One set of shapes separates into resting dots, then eases into quiet motion and speech.
struct CallDots: View {
    static let defaultGlassTintStrength = 0.25
    static let defaultGlassGradientStrength = 0.6

    let active: Bool
    let tint: Color
    var level: Float = 0
    var motionDisabled = false
    var glass: Glass? = .clear.tint(.mint.opacity(CallDots.defaultGlassTintStrength))
    var glassGradientStrength = CallDots.defaultGlassGradientStrength
    @Environment(\.callVisualState) private var visualState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var separation = 0.0
    @State private var motionStartedAt: Date?
    @State private var transitionGeneration = 0
    @State private var previousLevel = 0.0
    @State private var targetLevel = 0.0
    @State private var levelChangedAt = Date.now

    private var presentation: CallVisualState { visualState ?? CallVisualState(active: active, connected: true) }
    private var still: Bool { reduceMotion || motionDisabled }

    var body: some View {
        TimelineView(.animation(paused: !presentation.active || still || scenePhase != .active)) { timeline in
            let elapsed = motionStartedAt.map { max(0, timeline.date.timeIntervalSince($0)) } ?? 0
            let ramp = still ? 0 : min(1, elapsed / 0.2)
            CallShape(
                separation: separation,
                time: still ? 0 : timeline.date.timeIntervalSinceReferenceDate,
                motionTime: elapsed,
                motionAmount: ramp * ramp * (3 - 2 * ramp),
                level: smoothedLevel(at: timeline.date),
                motionDisabled: still,
                tint: tint,
                glass: glass,
                glassGradientStrength: glassGradientStrength,
            )
        }
        .onChange(of: presentation, initial: true) { old, new in
            transition(to: new, animated: old.active && new.active && old != new)
        }
        .onChange(of: still) { _, _ in transition(to: presentation, animated: false) }
        .onChange(of: level, initial: true) { _, new in
            let now = Date.now
            previousLevel = smoothedLevel(at: now)
            targetLevel = new.isFinite ? Double(max(0, min(1, new))) : 0
            levelChangedAt = now
        }
        .onDisappear {
            transitionGeneration += 1
            motionStartedAt = nil
        }
        .accessibilityHidden(true)
    }

    private func transition(to state: CallVisualState, animated: Bool) {
        transitionGeneration += 1
        let generation = transitionGeneration
        // Keep the last shape and breathing phase while CallVisual fades out.
        guard state.active else { return }
        motionStartedAt = nil
        let target = state.connected ? 1.0 : 0.0
        guard animated, !still else {
            // A new call starts with a blob, without reversing the previous call's morph.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                separation = target
                if target == 1 { motionStartedAt = .now }
            }
            return
        }
        withAnimation(.smooth(duration: 0.45), completionCriteria: .logicallyComplete) {
            separation = target
        } completion: {
            guard transitionGeneration == generation, target == 1 else { return }
            motionStartedAt = .now
        }
    }

    private func smoothedLevel(at date: Date) -> Double {
        let response = targetLevel > previousLevel ? 0.09 : 0.28
        let elapsed = max(0, date.timeIntervalSince(levelChangedAt))
        return targetLevel + (previousLevel - targetLevel) * exp(-elapsed / response)
    }
}

struct CallShape: View, Animatable {
    var separation: Double
    let time: TimeInterval
    var motionTime: TimeInterval = 0
    var motionAmount: Double = 0
    var level: Double = 0
    var motionDisabled = false
    let tint: Color
    var glass: Glass? = nil
    var glassGradientStrength = 0.0

    var animatableData: Double {
        get { separation }
        set { separation = newValue }
    }

    var body: some View {
        if let glass {
            GeometryReader { geometry in
                let shapes = rectangles(in: geometry.size)
                GlassEffectContainer(spacing: 8) {
                    ZStack {
                        ForEach(shapes.indices, id: \.self) { index in
                            let rect = shapes[index]
                            Color.clear
                                .frame(width: rect.width, height: rect.height)
                                .glassEffect(glass, in: .rect(cornerRadius: rect.width / 2))
                                .position(x: rect.midX, y: rect.midY)
                        }
                    }
                    .frame(width: geometry.size.width, height: geometry.size.height)
                }
            }
            .background {
                // Let the native glass sample the color beneath it and keep its highlights on top.
                if glassGradientStrength > 0 {
                    shadedShape(pronounced: true)
                        .opacity(min(1, glassGradientStrength))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
        } else {
            shadedShape()
        }
    }

    private func rectangles(in size: CGSize) -> [CGRect] {
        let progress = min(1, max(0, separation))
        let softness = 1 - progress
        return (0..<4).map { index in
            let offset = Double(index) - 1.5
            let phase = time * 1.6 + Double(index) * 1.4
            let dotPhase = motionTime * 1.5 + Double(index) * 0.82
            let voicePhase = motionTime * 3.2 + Double(index) * 0.82
            let breath = (sin(dotPhase) + 1) * 3
            // Land in the first breathing pose; ramp only the movement away from it.
            let restingBreath = motionDisabled ? 0 : (sin(Double(index) * 0.82) + 1) * 3
            let restingOffset = motionDisabled ? 0 : sin(Double(index) * 0.82) * 2
            let voice = level * (30 + (sin(voicePhase) + 1) * 29)
            let width = 38 + softness * (38 + sin(phase) * 4)
            let height = 38 + softness * (42 + cos(phase * 0.8) * 6) + progress * restingBreath + motionAmount * (breath - restingBreath + voice)
            let x = size.width / 2 + offset * (6 + 44 * progress)
            let y = size.height / 2 + sin(phase) * 5 * softness + progress * restingOffset + (sin(dotPhase) * 2 - restingOffset) * motionAmount
            return CGRect(x: x - width / 2, y: y - height / 2, width: width, height: height)
        }
    }

    private func shadedShape(pronounced: Bool = false) -> some View {
        Canvas { context, size in
            let progress = min(1, max(0, separation))
            let softness = 1 - progress
            let gradient = Gradient(
                stops: pronounced
                    ? [
                        .init(color: .white, location: 0),
                        .init(color: .white, location: 0.25),
                        .init(color: tint, location: 0.45),
                        .init(color: tint.mix(with: .black, by: 0.55), location: 0.8),
                        .init(color: tint.mix(with: .black, by: 0.55), location: 1),
                    ]
                    : [
                        .init(color: .white.opacity(0.95), location: 0),
                        .init(color: tint, location: 0.55),
                        .init(color: tint.mix(with: .black, by: 0.24), location: 1),
                    ])
            let shapes = rectangles(in: size)
            // Keep the liquid silhouette separate from its lighting so the filter does not flatten the color.
            context.clipToLayer { mask in
                mask.addFilter(.alphaThreshold(min: 0.5, color: .white))
                mask.addFilter(.blur(radius: 8 * softness))
                mask.drawLayer { layer in
                    for rect in shapes {
                        layer.fill(Path(roundedRect: rect, cornerRadius: rect.width / 2), with: .color(.white))
                    }
                }
            }
            let bounds = shapes.reduce(CGRect.null) { $0.union($1) }
            context.fill(
                Path(CGRect(origin: .zero, size: size)),
                with: .linearGradient(gradient, startPoint: bounds.origin, endPoint: CGPoint(x: bounds.maxX, y: bounds.maxY)),
            )
            // As the blob separates, each dot gradually gets its own highlight and shaded underside.
            context.opacity = progress
            for rect in shapes {
                let path = Path(roundedRect: rect, cornerRadius: rect.width / 2)
                context.fill(
                    path,
                    with: .linearGradient(gradient, startPoint: rect.origin, endPoint: CGPoint(x: rect.maxX, y: rect.maxY)),
                )
                context.stroke(path, with: .color(.white.opacity(0.16)), lineWidth: 0.5)
            }
        }
    }
}

#Preview("Quiet Call") {
    CallDots(active: true, tint: .mint)
        .frame(width: 240, height: 140)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { CallBackground() }
}

#Preview("Blob Shape") {
    @Previewable @State var separation = 0.0
    VStack(spacing: 32) {
        CallShape(separation: separation, time: 0, tint: .mint)
            .frame(width: 240, height: 140)
        Slider(value: $separation, in: 0...1) {
            Text("Separation")
        }
        .frame(width: 240)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { CallBackground() }
    .preferredColorScheme(.dark)
}
