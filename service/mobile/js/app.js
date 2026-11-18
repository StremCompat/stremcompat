/* StremCompat on a phone: the same local server and API as the native TV app (/app/...), drawn
   as an iOS or an Android app (core.js decides which), with tabs, a stack of views per tab,
   sheets for choices, and the phone's back closing what was opened last. */
import { api, ICON, readPrefs, setTexts, t } from './core.js';
import { setTabs } from './nav.js';
import { homeView } from './views/home.js';
import { searchView } from './views/search.js';
import { libraryView } from './views/library.js';
import { settingsView } from './views/settings.js';
import { signIn } from './views/signin.js';

async function start() {
  const [strings, state] = await Promise.all([api('/app/strings'), api('/app/state')]);
  setTexts(strings);
  if (state && state.language) document.documentElement.lang = state.language;
  if (!state || !state.signedIn) return signIn();
  readPrefs(await api('/app/settings?for=phone'));
  setTabs([
    { id: 'home', icon: ICON.home, label: () => t('navHome'), make: homeView },
    { id: 'search', icon: ICON.search, label: () => t('navSearch'), make: searchView },
    { id: 'library', icon: ICON.library, label: () => t('navLibrary'), make: libraryView },
    { id: 'settings', icon: ICON.settings, label: () => t('navSettings'), make: settingsView }
  ]);
}
start();
