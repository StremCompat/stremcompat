'use strict';

// Builds the Android TV apps: dist/StremCompat-v<version>-AndroidTV.apk and StremCompat-Native-v<version>-AndroidTV.apk.
//
//   1. the pages and the local server, staged as for LG with the android-tv profile (build-stage.js)
//   2. nodejs-mobile's Node for Android, downloaded once into .cache (scripts/lib/mobile-stage.js)
//   3. what android/app/build.gradle reads from .build/android-tv-app, then Gradle
//
// Needs the Android SDK and NDK (ANDROID_HOME, by default ~/Android/sdk), a JDK 17 or newer
// (JAVA_HOME), the ARM programs in service/bin (npm run runtime) and, for a signed package,
// ~/Android/stremcompat-signing.properties (see android/README.md).
//
// Usage: node scripts/package-android.js

var fs = require('fs');
var os = require('os');
var path = require('path');
var { root, run, nodeMobile, stageService } = require('./lib/mobile-stage');

var ABIS = ['armeabi-v7a', 'arm64-v8a'];
/* FFmpeg and FFprobe are static 32-bit ARM programs, which arm64 TVs that still run 32-bit code
   run too. The webOS torrent engine is built for webOS's C library and does not run on Android:
   torrents use WebTorrent inside the server instead (platforms/android/engine). */
var PROGRAMS = { ffmpeg: 'libffmpeg.so', ffprobe: 'libffprobe.so' };
var stage = path.join(root, '.build', 'android-tv-app');

(async function () {
  fs.rmSync(stage, { recursive: true, force: true });
  var profile = stageService(path.join(stage, 'assets', 'service'));
  var cache = await nodeMobile('android', path.join('bin', 'arm64-v8a', 'libnode.so'));
  ABIS.forEach(function (abi) {
    var libs = path.join(stage, 'jniLibs', abi);
    fs.mkdirSync(libs, { recursive: true });
    fs.copyFileSync(path.join(cache, 'bin', abi, 'libnode.so'), path.join(libs, 'libnode.so'));
    Object.keys(PROGRAMS).forEach(function (name) {
      var from = path.join(root, 'service', 'bin', name);
      if (!fs.existsSync(from)) throw new Error(from + ' is missing: run npm run runtime');
      fs.copyFileSync(from, path.join(libs, PROGRAMS[name]));
    });
  });
  fs.cpSync(path.join(cache, 'include'), path.join(stage, 'node', 'include'), { recursive: true });
  fs.cpSync(path.join(cache, 'bin'), path.join(stage, 'node', 'bin'), { recursive: true });

  /* the native app's own files (fonts, icons), next to this repository (LG-C/build.sh android) */
  var lgc = path.resolve(root, '..', '..', 'LG-C');
  fs.rmSync(path.join(lgc, 'build', 'android'), { recursive: true, force: true });
  fs.cpSync(path.join(lgc, 'assets'), path.join(lgc, 'build', 'android', 'assets'), { recursive: true });

  var env = Object.assign({}, process.env);
  if (!env.ANDROID_HOME) env.ANDROID_HOME = path.join(os.homedir(), 'Android', 'sdk');
  var android = path.join(root, 'android');
  run(
    path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
    ['--no-daemon', '-q', 'assembleRelease'],
    { cwd: android, env: env }
  );

  /* three apps with their own IDs: the web and native ones for TVs, and the phone one */
  var nativeVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'profiles', 'lg-native.json'), 'utf8')
  ).version;
  [
    ['web', 'StremCompat-v' + profile.version + '-AndroidTV'],
    ['native', 'StremCompat-Native-v' + nativeVersion + '-AndroidTV'],
    ['phone', 'StremCompat-Phone-v' + profile.version + '-beta-Android']
  ].forEach(function (flavor) {
    var apk = path.join(
      android,
      'app',
      'build',
      'outputs',
      'apk',
      flavor[0],
      'release',
      'app-' + flavor[0] + '-release.apk'
    );
    if (!fs.existsSync(apk))
      throw new Error(
        'Gradle finished without a signed package: is the signing file in place? See android/README.md'
      );
    var out = path.join(root, 'dist', flavor[1] + '.apk');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(apk, out);
    console.log('APK ready: ' + out + ' (' + (fs.statSync(out).size / 1048576).toFixed(1) + ' MB)');
  });
})().catch(function (e) {
  console.error(e.message);
  process.exit(1);
});
