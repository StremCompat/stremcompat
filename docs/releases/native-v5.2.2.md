# StremCompat Native 5.2.2 beta

> **Beta.** The stable version is StremCompat 4.5.2. The Native app installs next to it as a separate app.

## Faster loading

- **Catalogs never wait behind pictures.** The app had three network workers shared by catalogs, covers and backdrops, and each one also decoded its picture before taking the next request; on a TV a Home's catalogs queued behind its pictures. Now catalogs and details have four workers of their own, pictures three, and slow addons two.
- **An addon that stops answering no longer slows every Home:** a catalog that failed twice is not asked again for three minutes.
- **The local server has more helper threads** for name lookups and disk reads.

Everything else in [Native 5.2.1](https://github.com/StremCompat/webos/releases/tag/native-v5.2.1-beta) stays: the pointer that hides with the arrows, PIN profiles that keep their data, and Home backdrops.

---

**StremCompat is made by one person, in my free time.** If it made your TV useful again, a coffee keeps me going and is honestly what motivates me to keep improving it: **[buymeacoffee.com/Alexesmm](https://buymeacoffee.com/Alexesmm)** ☕

A star on GitHub also helps other people find the project.

*Português:* o StremCompat é feito por uma pessoa só, no tempo livre. Se ele deu vida nova à sua TV, um café me anima muito a continuar: buymeacoffee.com/Alexesmm
