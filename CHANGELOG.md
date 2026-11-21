# Changelog

What changed in each version, newest first. The full notes of each release are in [docs/releases](docs/releases) and on the Releases pages of [webOS](https://github.com/StremCompat/webos/releases), [Samsung](https://github.com/StremCompat/samsung/releases) and [Android TV](https://github.com/StremCompat/android-tv/releases).

## Unreleased

## Native 5.3.1

- The Native app opens again on LG and Samsung: Native 5.2.5 to 5.3.0 were built before their version was changed, so they waited for a local server of the version before and stayed on the opening screen. Packaging now refuses a native build of another version.
- The opening screen says after 20 s where the service and the server stand.

## 4.6.0 / Native 5.3.0

- Faster playback: since 4.5.9 the local server wrote its list of sources to disk for every piece of a playing video; it now writes it at most once a minute.
- The standard look measures how the TV keeps up and, where its transitions make frames late, drops only its motion (as the light look does), keeping its pictures and shadows.
- Episode ratings also with metadata addons that give none (TMDB, AIOMetadata): Cinemeta completes them; the focused episode's line shows its rating.
- The subtitle size, colour and background chosen in the player are kept for the next videos, as Settings keeps them.

## 4.5.9 / Native 5.2.8

- Continue (S1 E2 and the like) works after an update or a restart: the local server keeps the recent sources on disk, and a source it no longer has opens that episode's sources instead of a loading screen that went back.
- Each episode shows its rating (IMDb's, from the metadata addon) beside its air date.
- A title opens at once with what its card knew (name, picture, synopsis and facts), as Stremio and Nuvio do, instead of an empty page until the addon answered.
- The subtitle delay is offered for every subtitle it can move (also those read out of the file on LG), and in the Native app's subtitles list too.

## 4.5.8 / Native 5.2.7

- LG, webOS 10 (webOS 25): the app's start request reaches the service even where the TV's activity manager never answers (it waited forever and showed RUNTIME_START_TIMEOUT), and the service starts the local server as soon as it loads, so the start screen finds it by itself.
- Native 5.2.7 changes only the LG app (its service); on Samsung and Android TV it keeps the versions level.

## 4.5.7

- A change in the player's subtitle Style or Delay shows on the line on screen at once, also paused; it waited for the next line.

## 4.5.6 / Native 5.2.6

- Subtitles in one menu: each language once, with the file's own subtitles first and then each addon; an addon with several subtitles opens them, and a language or an addon with one is chosen at once.
- Subtitles look like those of Nuvio's TV app: regular letters with a solid outline all around, no shadow, at Nuvio's usual size (larger on 1080p TVs).
- The Sources of the player show each addon's sources as they come and the menu stays while addons are still asked (it used to close empty).
- Native: Back in a subtitle language or addon goes up one level.

## 4.5.5 / Native 5.2.5

- The bolt of a cached source no longer repeats over its "TB" letters on the source in focus.
- Native 5.2.5 changes only the LG app (its service); on Samsung and Android TV it brings the version level.
- LG: the app's service no longer ends itself 5 s after starting on TVs that refuse it an activity (webOS 10 seems to), which took the local server with it and showed "... is not running" (webos#14). The launcher also asks the service again twice before showing an error.

## 4.5.4 / Native 5.2.4 (Samsung only)

- Samsung: the local service also starts the way newer TVs need (Samsung's `wrt:service` module), and is asked again while the app waits for it. On recent TVs the old way answered but brought nothing up, so the app stopped on "could not finish loading" or a black screen.

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
