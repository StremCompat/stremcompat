#!/bin/bash
# Screenshots of the iOS app on the simulator, with the preview addon and a throwaway account:
# sign-in, then Home, a title, Search, Library and Settings.
# Run after the simulator build (.github/workflows/ios.yml), from the repository's root.
set -euo pipefail

APP=ios/build/dd-sim/Build/Products/Debug-iphonesimulator/StremCompat.app
OUT=ios/build/screens
SERVER=http://127.0.0.1:8085
mkdir -p "$OUT"

node scripts/preview-addon.js > "$OUT/addon.log" 2>&1 &
DEVICE=$(xcrun simctl list devices available | grep -m1 -E '^\s+iPhone 1[5-7] ' | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
echo "simulator $DEVICE"
xcrun simctl boot "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b
xcrun simctl install "$DEVICE" "$APP"
xcrun simctl launch "$DEVICE" io.github.alexesmm.stremcompat

for i in $(seq 1 90); do curl -sf "$SERVER/health" > /dev/null && break; sleep 2; done
curl -sf "$SERVER/health"
sleep 6
shot() { sleep "$2"; xcrun simctl io "$DEVICE" screenshot "$OUT/$1.png"; }
shot 00-sign-in 0

node scripts/preview-addon.js --account "$SERVER"
# the page to open goes to a file the Debug app reads (WebController.watchTestPage): a
# stremcompat:// link would make the system ask before opening it
DOCS="$(xcrun simctl get_app_container "$DEVICE" io.github.alexesmm.stremcompat data)/Documents"
mkdir -p "$DOCS"
open_page() { printf '%s' "/m/?platform=ios$1" > "$DOCS/open.txt"; }
open_page ""
shot 01-home 12
open_page "&open=series/tt0903747"
shot 02-title 12
open_page "&tab=search"
shot 03-search 10
open_page "&tab=library"
shot 04-library 8
open_page "&tab=settings"
shot 05-settings 8
xcrun simctl spawn "$DEVICE" log show --last 5m --predicate 'eventMessage CONTAINS "StremCompat"' --style compact > "$OUT/app.log" || true
