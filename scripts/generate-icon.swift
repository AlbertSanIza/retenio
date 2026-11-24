// Run with: swift scripts/generate-icon.swift
import AppKit
import CoreGraphics

let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
    space: colorSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
)!
let colors =
    [
        CGColor(red: 0.025, green: 0.40, blue: 0.33, alpha: 1),
        CGColor(red: 0.01, green: 0.16, blue: 0.14, alpha: 1),
    ] as CFArray
let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0, 1])!
context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 1024), end: CGPoint(x: 1024, y: 0), options: [])
let glow = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        CGColor(red: 0.1, green: 0.8, blue: 0.63, alpha: 0.45),
        CGColor(red: 0, green: 0.3, blue: 0.2, alpha: 0),
    ] as CFArray, locations: [0, 1])!
context.drawRadialGradient(
    glow, startCenter: CGPoint(x: 512, y: 550), startRadius: 0,
    endCenter: CGPoint(x: 512, y: 550), endRadius: 500, options: [])
let face = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        CGColor(red: 0.86, green: 1, blue: 0.95, alpha: 1),
        CGColor(red: 0.36, green: 0.9, blue: 0.7, alpha: 1),
        CGColor(red: 0.03, green: 0.52, blue: 0.41, alpha: 1),
    ] as CFArray, locations: [0, 0.45, 1])!
for (index, height) in [200.0, 390.0, 310.0, 180.0].enumerated() {
    let rect = CGRect(x: 230 + Double(index) * 150, y: (1024 - height) / 2, width: 114, height: height)
    let path = CGPath(roundedRect: rect, cornerWidth: 57, cornerHeight: 57, transform: nil)
    context.saveGState()
    context.setShadow(
        offset: CGSize(width: 0, height: -18), blur: 32,
        color: CGColor(red: 0, green: 0.06, blue: 0.04, alpha: 0.75))
    context.setFillColor(CGColor(red: 0.1, green: 0.7, blue: 0.55, alpha: 1))
    context.addPath(path)
    context.fillPath()
    context.restoreGState()
    context.saveGState()
    context.addPath(path)
    context.clip()
    context.drawLinearGradient(
        face, start: CGPoint(x: rect.midX, y: rect.maxY), end: CGPoint(x: rect.midX, y: rect.minY), options: [])
    context.restoreGState()
    context.setStrokeColor(CGColor(red: 0.75, green: 1, blue: 0.89, alpha: 0.55))
    context.setLineWidth(2)
    context.addPath(path)
    context.strokePath()
}
let representation = NSBitmapImageRep(cgImage: context.makeImage()!)
let png = representation.representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: "retenio/Assets.xcassets/AppIcon.appiconset/AppIcon.png"))
