# StremCompat Native 5.2.4 beta

> **Beta, for Samsung only.** The stable version is StremCompat 4.5.4. The Native app installs next to it as a separate app.

## Fixed

- **No more black screen on newer Samsung TVs.** The Native app uses the same local service as the web one, and on recent Tizen versions that service never started. It now also starts the way Samsung documents for these TVs (the `wrt:service` module), and the app asks again while it waits. Older TVs keep starting it as before.

Everything else in [Native 5.2.3](https://github.com/StremCompat/samsung/releases/tag/native-v5.2.3-beta) stays.

---

**StremCompat is made by one person, in my free time.** If it made your TV useful again, a coffee keeps me going and is honestly what motivates me to keep improving it: **[buymeacoffee.com/Alexesmm](https://buymeacoffee.com/Alexesmm)** ☕

A star on GitHub also helps other people find the project.

*Português:* o StremCompat é feito por uma pessoa só, no tempo livre. Se ele deu vida nova à sua TV, um café me anima muito a continuar: buymeacoffee.com/Alexesmm
