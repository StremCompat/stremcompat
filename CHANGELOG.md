# Changelog

What changed in each version, newest first. The full notes of each release are in [docs/releases](docs/releases) and on the Releases pages of [webOS](https://github.com/StremCompat/webos/releases), [Samsung](https://github.com/StremCompat/samsung/releases) and [Android TV](https://github.com/StremCompat/android-tv/releases).

## Unreleased

## 4.5.3 / Native 5.2.3

- Native: the Nuvio profile's picture at the top of the side menu again, and it can be selected (who is watching, or the account for Stremio).
- Native: subtitles grouped by language, and languages matched whatever code the file or the addon uses ("por", "pob", "pt-BR").
- Native: the recommended source leads the list and has the focus when the sources open; more workers for slow addons.

## 4.5.2 / Native 5.2.2

- A catalog that failed twice is not asked again for three minutes.
- More of Node's helper threads for the local server.
- Native: catalogs, pictures and slow addons each have their own network workers.

## 4.5.1 / Native 5.2.1

- A Nuvio profile protected by a PIN keeps its addons, collections and Home when entered again.
- No cap again on connections to an addon's server.
- The bolt of a cached source stays on the source in focus.
- Native: the Magic Remote pointer hides with the arrows, the focus follows it once it rests, and full-size backdrops are no longer sent to it.

## 4.5.0 / Native 5.2.0

- Torrents let go when you leave the player or change sources (webos#19); clearing the torrent cache works once nothing plays.
- A stuck local server is found and replaced when the app opens again.
- Collection covers show at once; catalog rows are asked again before they are hidden.
- Watched marks in bulk for a season or a series; Mark series unwatched is back.
- A phone-style PIN pad.
- Native: the Magic Remote pointer on every screen.

## 4.4.3

- New and upcoming episodes share one row on Home.

## 4.4.2

- Home catalogs restored next to Nuvio collections.

## 4.4.1 / Native 5.1.1

- Continue Watching keeps the right episode; Hi10P sources back in the normal list.
- Native on Android TV starts again.

## 4.4.0 / Native 5.1.0

- Cached sources first, source origin badges, quick filters, a healthy 1080p as Recommended.
- Skip intro and recap, better subtitle choice, upcoming episodes, no spoilers, screensaver, search from the phone.
- Native: the picture on webOS 3 and 4 through ACB.
