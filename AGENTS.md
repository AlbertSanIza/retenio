# Retenio

- Support iPhone and iPad, including landscape and resizable iPad windows.
- Keep code minimal: reuse SwiftUI and Apple SDKs before adding custom code or dependencies. Follow Apple’s current guidance; write custom behavior only when the native API does not fit.
- When changing existing code, remove unused code and unnecessary wrappers. Keep abstractions only when they reduce duplication or protect correctness; avoid speculative infrastructure.
- Follow [Apple’s Liquid Glass guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): prefer native controls and layered Icon Composer app icons; let the system provide material effects.
- Keep Xcode previews focused on iPhone; iPad remains a supported runtime target.
- Keep layouts accessible and verify changes on both device sizes.
- Keep PRs focused and use one commit per logical change.
