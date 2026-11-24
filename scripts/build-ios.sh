#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -project retenio.xcodeproj -scheme retenio -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "${RETENIO_BUILD_DIR:-/tmp/retenio-build}" CODE_SIGNING_ALLOWED=NO build
