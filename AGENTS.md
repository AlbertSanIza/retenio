# Retenio

- Support iPhone and iPad, including landscape and resizable iPad windows.
- Keep code minimal: reuse SwiftUI and Apple SDKs before adding custom code or dependencies. Follow Apple’s current guidance; write custom behavior only when the native API does not fit.
- When changing existing code, remove unused code and unnecessary wrappers. Keep abstractions only when they reduce duplication or protect correctness; avoid speculative infrastructure.
- Follow [Apple’s Liquid Glass guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): prefer native controls and layered Icon Composer app icons; let the system provide material effects.
- Keep Xcode previews focused on iPhone; iPad remains a supported runtime target.
- Keep layouts accessible and verify changes on both device sizes.
- Keep PRs focused and use one commit per logical change.

## Source organization and stacked changes

- Keep only the app entry point and main screen at the source root. Group implementation files by responsibility: Audio, Voice, Components, Appearance, Library, Settings, and Connections.
- When moving or deleting a file in a stack, propagate the change through every open dependent PR. Compare old and new paths so newer implementations are preserved and duplicate source files are removed.
- Before handing back a restacked change, run the source-layout check and build each affected layer; run regression tests at the stack tip. Do not treat a successful build of one layer as validation of its descendants.

- Write development scripts in TypeScript and run them with Bun; prefer Bun’s native APIs.
