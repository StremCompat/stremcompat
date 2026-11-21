'use strict';

// The native interface checks at start that the local server is of its own version (LG-C
// src/screens/boot.c), a version written into it when it is built (LG-C build.sh reads it from
// profiles/lg-native.json). A build made before the version changed waits for ever for a server
// of the old version, as Native 5.2.5 to 5.3.0 did: the package is refused instead.

var fs = require('fs');

function assertNativeVersion(files, version) {
  var wanted = Buffer.from(version + '\0', 'utf8');
  files.forEach(function (file) {
    if (fs.readFileSync(file).indexOf(wanted) < 0)
      throw new Error(
        file +
          ' was built for another version than ' +
          version +
          ': build LG-C again (./build.sh webos, tizen) after the version changed'
      );
  });
}

module.exports = { assertNativeVersion: assertNativeVersion };
