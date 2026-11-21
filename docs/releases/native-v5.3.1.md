# StremCompat Native 5.3.1 beta

> **Beta.** The stable version is StremCompat 4.6.0. The Native app installs next to it as a separate app.

## Fixed

- **The Native app opens again.** On LG and Samsung, Native 5.2.5 to 5.3.0 could stay on the opening screen for ever, even after unplugging the TV: each was built before its version number was changed, so it waited for a local server of the version before. This one is built for its own version, and the packaging now refuses a build that is not. On Android TV the Native app was not affected.
- **A clearer opening screen.** If it ever takes long, after 20 seconds it shows a small line with where the service and the server stand; a photo of it helps to find the cause.

Everything else in [Native 5.3.0](https://github.com/StremCompat/webos/releases/tag/native-v5.3.0-beta) stays.

---

**StremCompat is made by one person, in my free time.** If it made your TV useful again, a coffee keeps me going and is honestly what motivates me to keep improving it: **[buymeacoffee.com/Alexesmm](https://buymeacoffee.com/Alexesmm)** ☕

A star on GitHub also helps other people find the project.

*Português:* o StremCompat é feito por uma pessoa só, no tempo livre. Se ele deu vida nova à sua TV, um café me anima muito a continuar: buymeacoffee.com/Alexesmm
