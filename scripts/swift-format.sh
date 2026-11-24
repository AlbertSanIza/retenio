#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:---check}"
shift || true
if [[ "$mode" != --check && "$mode" != --write ]]; then
    echo 'Usage: scripts/swift-format.sh [--check|--write] [files...]' >&2
    exit 2
fi
files=()
if [[ $# -eq 0 ]]; then
    while IFS= read -r -d '' file; do files+=("$file"); done < <(git ls-files -z -- '*.swift')
else
    files=("$@")
fi
[[ ${#files[@]} -gt 0 ]] || exit 0
result=0
for file in "${files[@]}"; do
    [[ -f "$file" ]] || continue
    if [[ "$mode" == --write ]]; then
        xcrun swift-format format --configuration .swift-format --in-place "$file"
    elif ! xcrun swift-format format --configuration .swift-format "$file" | diff -u "$file" -; then
        result=1
    fi
done
exit "$result"
