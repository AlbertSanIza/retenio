#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun scripts/check-source-layout.ts
if [[ -n "${RETENIO_TEST_DESTINATION:-}" ]]; then
    destination="$RETENIO_TEST_DESTINATION"
else
    simulator_id=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
inventory = json.load(sys.stdin)
phones = [device for runtime, devices in inventory["devices"].items()
          if "iOS-27-2" in runtime for device in devices
          if device["name"].startswith("iPhone")]
if not phones:
    sys.exit("Install an iOS 27.2 Simulator runtime to run tests.")
print(next((device for device in phones if device["state"] == "Booted"), phones[0])["udid"])
')
    destination="platform=iOS Simulator,id=$simulator_id"
fi
xcodebuild -project retenio.xcodeproj -scheme Retenio -configuration Debug \
    -destination "$destination" -derivedDataPath "${RETENIO_BUILD_DIR:-$PWD/build/tests}" \
    -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
