# Playgrounds

Reusable, interactive Xcode previews for exploring UI ideas, tuning appearance, and sharing screenshots before applying changes to the app.

- Keep each playground self-contained and focused on one area. Name the file after that area, without a `Playground` suffix.
- Include one iPhone preview and keep playground code behind `#if DEBUG`. Do not add app navigation or launch switches for it.
- Keep experimental settings local; they must not change app preferences or production defaults.
- Prefer native SwiftUI controls and reuse app components where practical. Show exact values for adjustable settings so screenshots can guide implementation.
