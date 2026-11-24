# Retenio for iPhone

A native SwiftUI voice-call prototype. Open `retenio.xcodeproj` in Xcode 27.2, select the `retenio` scheme, and run on an iPhone or iOS 27.2 simulator. No third-party Swift packages are required.

Tap the green call button, allow microphone access, and start talking. The same button turns red to hang up. There is no API key entry or settings screen. The voice conversation can reason, search the web, and quiz due cards through the existing Retenio MCP server. The call screen stays focused on voice; no card grid or account setup is needed.

## Private build configuration

This owner-only prototype embeds the developer's OpenAI API key in `retenio/LocalVoiceConfiguration.plist`. The file is git-ignored and copied into the app bundle by Xcode. Its dictionary must contain a nonempty string named `OpenAIAPIKey`. Configure this file locally before building; never commit it or place a real key in documentation or build arguments.

The credential is recoverable from the installed binary. Do not distribute this build. Move session creation to an authenticated backend before public distribution. Calls use the configured project's API balance and require access to `gpt-live-1.1`.

## Connection and audio

- Connects directly to GPT-Live 1.1 using Marin, with a brief greeting and a playful learning prompt.
- Uses managed Responses delegation with GPT-6.2 Sol (low reasoning effort) and hosted web search. Backend model and tool use are billed separately from voice duration.
- Connects to `https://retenio.vercel.app/api/mcp` for due questions, question images, and review ratings. Retrieval is automatic; the learner’s clear spoken Again/Hard/Good/Easy authorizes saving that rating, with no confirmation dialog. Ambiguous choices are clarified aloud. After saving, the quiz moves to the next question; skip never saves a rating. The backend receives card data through this integration.
- Shows input/output captions, actual backend activity, safe clickable citations in an in-app browser, and a check-in button during long waits. Transcript timing is approximate; a waiting label does not claim access to internal reasoning.
- Offers Surprise me and Quiz my cards during the opening conversation. Tracks network health and detects stopped event delivery rather than displaying indefinite activity.
- Uses native `AVAudioEngine` capture/playback, with voice processing and echo cancellation on iPhone. The simulator uses the Mac audio route without voice processing; use headphones to avoid feedback.
- Matches the voice-processing input/output hardware formats and restarts the audio engine after hardware format changes, preserving pending reply buffers.
- Streams mono 24 kHz PCM16 through an ordered, bounded queue. The animated dots respond to assistant audio and respect Reduce Motion.
- Includes timer, mute/unmute, audio routing, and hangup. Closing the app, system audio interruptions, and disconnected audio devices end the call. Background calling and CallKit are not implemented.

## Verification

```sh
xcodebuild -project apple/retenio.xcodeproj -scheme retenio \
  -configuration Debug -destination 'generic/platform=iOS Simulator' build
```

Check greeting playback, speaking and interrupting, mute/unmute, audio routing, hangup/restart, denied microphone permission, network loss, and backgrounding. Verify receiver/Bluetooth behavior on a physical iPhone.

For a repeatable physical-device regression check, add `--voice-smoke-test` to the Debug scheme's launch arguments. This makes two short, billable calls, checks microphone capture and completed playback (not merely received network audio), exercises mute and receiver/speaker routing, and verifies hangup/restart. Look for `Voice smoke test PASS` in the console. Remove the argument for normal launches. Confirm audible output on the phone as well; software counters alone cannot prove the speaker is audible. The test logs no credentials or conversation content and is excluded from Release builds.

Run event-state regression checks without an API call:

```sh
swiftc apple/retenio/CallActivity.swift apple/retenio/VoiceHangup.swift apple/retenio/LiveSessionConfiguration.swift apple/tests/main.swift -o /tmp/retenio-activity-tests
/tmp/retenio-activity-tests
```

The Debug launch argument `--voice-tools-test` checks hosted web search, citations, MCP question retrieval, activity transitions, captions, and actual audio playback in one short call. It does not save review ratings. Normal launches do not run either smoke test.

## Motion and layout

The opening screen features a large centered Retenio wordmark and a green call button. Starting a call moves the wordmark upward, reveals the voice visualizer, and turns that same button into the red hang-up control. The visualizer and controls stay anchored while the conversation changes. Captions and source links scroll in a separate bounded area and cannot move the dots or controls. The four-dot renderer uses `CADisplayLink` and Core Animation layers with smoothed audio levels, requesting the display’s supported refresh rate (including ProMotion). Reduce Motion disables the continuous movement. Audio packets do not invalidate the entire SwiftUI layout.

For on-device profiling, launch a Debug build with `--visual-motion-test` (optionally alongside a voice smoke test). Console metrics report delivered animation frame rate, longest callback interval, and vertical anchor drift. Frame rate remains subject to iOS power and thermal policies.

## Spoken hang-up

A clear goodbye or request to hang up invokes the app's `end_call` function. The app lets the farewell finish playing, then sends `session.close` and stops the microphone. A six-second fallback prevents a stalled farewell from leaving the session running. New speech during the grace period cancels the pending hang-up; the backend also has `cancel_end_call` for an explicit change of mind. Stopping a quiz, negating a hang-up, or discussing/translating the word goodbye must not end the call.

`--voice-hangup-test` runs a short Debug call and verifies the native tool handler automatically returns to idle without a tap. The event-state checks cover the grace period, playback waiting, deadline, and new-speech cancellation.
