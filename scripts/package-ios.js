'use strict';

// Stages what the iOS app's Xcode project reads (ios/project.yml), on macOS:
//
//   ios/build/service                  the pages and the local server, with the torrent engine
//   ios/build/NodeMobile.xcframework   nodejs-mobile's Node for iOS (downloaded once into .cache)
//   ios/StremCompat/Assets.xcassets    the app icon, from docs/assets/stremcompat-logo.png
//
// Then: cd ios && xcodegen generate && pod install, and xcodebuild (.github/workflows/ios.yml).
//
// Usage: node scripts/package-ios.js

var fs = require('fs');
var path = require('path');
var { root, nodeMobile, stageService } = require('./lib/mobile-stage');

var ios = path.join(root, 'ios');

(async function () {
  stageService(path.join(ios, 'build', 'service'));
  var cache = await nodeMobile('ios', path.join('NodeMobile.xcframework', 'Info.plist'));
  var framework = path.join(ios, 'build', 'NodeMobile.xcframework');
  fs.rmSync(framework, { recursive: true, force: true });
  fs.cpSync(path.join(cache, 'NodeMobile.xcframework'), framework, {
    recursive: true,
    verbatimSymlinks: true
  });
  fs.copyFileSync(
    path.join(root, 'docs', 'assets', 'stremcompat-logo.png'),
    path.join(ios, 'StremCompat', 'Assets.xcassets', 'AppIcon.appiconset', 'icon.png')
  );
  console.log('iOS files staged in ' + path.join(ios, 'build'));
})().catch(function (e) {
  console.error(e.message);
  process.exit(1);
});
