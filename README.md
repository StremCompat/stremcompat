# StremCompat source code

<p align="center">
  <img src="docs/assets/stremcompat-hero-en.png" alt="StremCompat home screen" width="1200">
</p>

StremCompat brings your **Stremio or Nuvio** account and addons to TVs the official apps left behind. This repository holds the source code of the web version and of the local server that both versions use. It is an independent, unofficial project, not affiliated with or endorsed by Stremio, Nuvio, LG, Samsung or Google.

> **Looking to install it?** Pick your TV. Each page has the downloads, installation steps, screenshots and compatibility tables.
>
> | TV | Page |
> |---|---|
> | **LG** (webOS 3 and newer) | [StremCompat/webos](https://github.com/StremCompat/webos) |
> | **Samsung** (Tizen 4 and newer) | [StremCompat/samsung](https://github.com/StremCompat/samsung) |
> | **Android TV / Google TV** (7.0 and newer) | [StremCompat/android-tv](https://github.com/StremCompat/android-tv) |
>
> This repository used to be `Alexesmm/stremcompat-lg-webos`. Old links still work, and the LG Homebrew addresses keep updating the app with your data in place.

## The two versions

| | **StremCompat** (stable) | **StremCompat Native** (beta, not stable yet) |
|---|---|---|
| Interface | A web page (ES5, runs on Chromium 38), in [`src/ui`](src/ui) | C with SDL2 and OpenGL ES, in [StremCompat/native](https://github.com/StremCompat/native) |
| Server | This repository's [`service`](service), shared by both | The same |

Most of the app's logic (Home rows, accounts, library, catalogs) lives in the shared data modules in [`src/ui/data`](src/ui/data). The web interface uses them directly. The server runs the same modules and serves them to the native version as a JSON API under `/app`, so both versions behave the same.

## Repository layout

| Folder | What is in it |
|---|---|
| [`src/ui`](src/ui) | Web interface: views, data modules, styles and texts |
| [`src/player`](src/player) | Web player: controls, subtitles, sources and progress |
| [`service`](service) | Local Node server: addon bridge, proxy, torrents, subtitles, channels, store, `/app` API |
| [`platforms`](platforms), [`app`](app) | LG and Samsung packaging |
| [`android`](android) | Android TV app (two flavors: `web` and `native`) |
| [`profiles`](profiles) | One build profile per package (ID, version, port, resolution) |
| [`scripts`](scripts) | Builds, packaging and tests |
| [`docs`](docs) | [Technical notes](docs/TECHNICAL.md), release notes and images |

## Building

Requirements: Node 20 or newer, and PowerShell on Windows. Run `npm ci`, then `npm run runtime` to fetch the ARM programs (Node, FFmpeg).

| Package | Command |
|---|---|
| LG, 1080p and 720p | `npm run package` and `npm run package:720` |
| LG Native | build [StremCompat/native](https://github.com/StremCompat/native) (`./build.sh webos`), then `powershell scripts/build.ps1 -Profile lg-native` |
| Samsung | `npm run package:tizen` (`-Target tizen-native` for the native version) |
| Android TV | `npm run package:android` (needs the Android SDK and NDK; see [android/README.md](android/README.md)) |

## Tests

- `npm test` runs the interface, player, server and Chromium 38 tests.
- `npm run test:visual:layouts` checks the layout at 720p and 1080p in headless Chrome.
- `npx eslint .` runs the linter.

The tests run headless. Nothing opens on screen.

## Contributing

Questions and ideas go to [Discussions](https://github.com/StremCompat/webos/discussions), reproducible bugs to the Issues of your TV's page. See [CONTRIBUTING.md](CONTRIBUTING.md).

If StremCompat has been useful to you, you can [buy me a coffee ☕](https://buymeacoffee.com/Alexesmm), entirely optional.

Licensed under [GPL-3.0](LICENSE). Third-party notices are in [THIRD_PARTY.md](THIRD_PARTY.md) and [NOTICE.md](NOTICE.md).
