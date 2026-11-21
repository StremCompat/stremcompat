# StremCompat Native 5.2.7 beta

> **Beta.** The stable version is StremCompat 4.5.8. The Native app installs next to it as a separate app.
>
> The fix below is for LG. On Samsung and Android TV this version is the same app as Native 5.2.6, released so the version matches on every TV.

## Fixed

- **The app's service starts on newer LG TVs (webOS 10 / webOS 25).** The Native app uses the same service as the web one; on these TVs the system held the start request back, so the local server never came up. It now starts as soon as the service loads ([webos#14](https://github.com/StremCompat/webos/issues/14)).

Everything else in [Native 5.2.6](https://github.com/StremCompat/webos/releases/tag/native-v5.2.6-beta) stays.

---

**StremCompat is made by one person, in my free time.** If it made your TV useful again, a coffee keeps me going and is honestly what motivates me to keep improving it: **[buymeacoffee.com/Alexesmm](https://buymeacoffee.com/Alexesmm)** ☕

A star on GitHub also helps other people find the project.

*Português:* o StremCompat é feito por uma pessoa só, no tempo livre. Se ele deu vida nova à sua TV, um café me anima muito a continuar: buymeacoffee.com/Alexesmm
