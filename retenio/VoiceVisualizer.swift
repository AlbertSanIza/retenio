import QuartzCore
import SwiftUI
import UIKit

struct VoiceVisualizer: UIViewRepresentable {
    let level: Float
    let active: Bool
    let tint: Color
    let reduceMotion: Bool
    let visible: Bool

    func makeUIView(context: Context) -> VoiceVisualizerView { VoiceVisualizerView() }
    func updateUIView(_ view: VoiceVisualizerView, context: Context) {
        view.configure(level: level, active: active, tint: UIColor(tint), reduceMotion: reduceMotion, visible: visible)
    }
    static func dismantleUIView(_ view: VoiceVisualizerView, coordinator: ()) { view.stopAnimating() }
}

/// Four lightweight layers animate independently of SwiftUI text layout and network cadence.
final class VoiceVisualizerView: UIView {
    private final class DisplayTarget: NSObject {
        weak var view: VoiceVisualizerView?
        @objc func tick(_ link: CADisplayLink) { view?.tick(link) }
    }
    private let displayTarget = DisplayTarget()
    private var displayLink: CADisplayLink?
    private let dots = (0..<4).map { _ in CAGradientLayer() }
    private var targetLevel: CGFloat = 0
    private var smoothedLevel: CGFloat = 0
    private var targetActivity: CGFloat = 0
    private var activity: CGFloat = 0
    private var color: [CGFloat] = [0.64, 1, 0.87]
    private var targetColor: [CGFloat] = [0.64, 1, 0.87]
    private var reduceMotion = false
    private var shouldAnimate = false
    private var previousTimestamp: CFTimeInterval = 0
    private var phase: Double = 0
    #if DEBUG
        private let measureMotion = ProcessInfo.processInfo.arguments.contains("--visual-motion-test")
        private var measuredTime: Double = 0
        private var measuredFrames = 0
        private var maxGap: Double = 0
        private var minCenterY = CGFloat.greatestFiniteMagnitude
        private var maxCenterY = -CGFloat.greatestFiniteMagnitude
    #endif

    init() {
        super.init(frame: .zero)
        isOpaque = false
        isUserInteractionEnabled = false
        displayTarget.view = self
        for dot in dots {
            dot.startPoint = CGPoint(x: 0.25, y: 0)
            dot.endPoint = CGPoint(x: 0.75, y: 1)
            dot.cornerRadius = 19
            dot.cornerCurve = .continuous
            layer.addSublayer(dot)
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(level: Float, active: Bool, tint: UIColor, reduceMotion: Bool, visible: Bool) {
        targetLevel = CGFloat(max(0, min(1, level)))
        targetActivity = active ? 1 : 0
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        tint.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        targetColor = [red, green, blue]
        self.reduceMotion = reduceMotion
        shouldAnimate = visible && !reduceMotion
        displayLink?.isPaused = !shouldAnimate
        if !shouldAnimate { previousTimestamp = 0 }
        if !visible {
            smoothedLevel = 0
            activity = 0
        }
        if reduceMotion {
            color = targetColor
            drawDots()
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        stopAnimating()
        guard let window else { return }
        let maximum = Float(window.windowScene?.screen.maximumFramesPerSecond ?? 60)
        let link = CADisplayLink(target: displayTarget, selector: #selector(DisplayTarget.tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: min(60, maximum), maximum: maximum, preferred: maximum)
        link.isPaused = !shouldAnimate
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stopAnimating() {
        displayLink?.invalidate()
        displayLink = nil
        previousTimestamp = 0
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        drawDots()
    }

    private func tick(_ link: CADisplayLink) {
        let elapsed =
            previousTimestamp == 0 ? link.targetTimestamp - link.timestamp : link.timestamp - previousTimestamp
        previousTimestamp = link.timestamp
        let dt = min(max(elapsed, 0), 1.0 / 15)
        // Fast attack, gentle release. Packet boundaries never become height jumps.
        let response = targetLevel > smoothedLevel ? 0.09 : 0.28
        smoothedLevel += (targetLevel - smoothedLevel) * CGFloat(1 - exp(-dt / response))
        activity += (targetActivity - activity) * CGFloat(1 - exp(-dt / 0.35))
        for index in 0..<3 { color[index] += (targetColor[index] - color[index]) * CGFloat(1 - exp(-dt / 0.3)) }
        phase += dt
        drawDots()
        #if DEBUG
            if measureMotion {
                measuredTime += elapsed
                measuredFrames += 1
                maxGap = max(maxGap, elapsed)
                let centerY = convert(CGPoint(x: bounds.midX, y: bounds.midY), to: nil).y
                minCenterY = min(minCenterY, centerY)
                maxCenterY = max(maxCenterY, centerY)
                if measuredTime >= 4 {
                    print(
                        "Voice visualizer: fps=\(Int((Double(measuredFrames) / measuredTime).rounded())), maxGapMS=\(Int(maxGap * 1000)), anchorDrift=\(maxCenterY - minCenterY)"
                    )
                    measuredTime = 0
                    measuredFrames = 0
                    maxGap = 0
                    minCenterY = centerY
                    maxCenterY = centerY
                }
            }
        #endif
    }

    private func drawDots() {
        guard bounds.width > 0 else { return }
        let tint = UIColor(red: color[0], green: color[1], blue: color[2], alpha: 1).cgColor
        let colors = [UIColor.white.cgColor, tint]
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (index, dot) in dots.enumerated() {
            let offset = Double(index) * 0.82
            let breath = (sin(phase * 1.5 + offset) + 1) * 0.5
            let voice = (sin(phase * 3.2 + offset) + 1) * 0.5
            let height: CGFloat =
                reduceMotion
                ? 38
                : 38 + CGFloat(breath) * 6
                    + activity * smoothedLevel * (30 + CGFloat(voice) * 58)
            dot.bounds = CGRect(x: 0, y: 0, width: 38, height: height)
            dot.position = CGPoint(x: bounds.midX + CGFloat(index) * 50 - 75, y: bounds.midY)
            dot.colors = colors
        }
        CATransaction.commit()
    }
}
