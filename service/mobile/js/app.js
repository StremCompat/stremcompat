/* StremCompat on a phone: the same local server and API as the native TV app (/app/...), drawn
   as an iOS or an Android app (core.js decides which), with tabs, a stack of views per tab,
   sheets for choices, and the phone's back closing what was opened last. */
import { api, ICON, readPrefs, setTexts, t } from './core.js';
import { selectTab, setTabs } from './nav.js';
import { openItem, stateBox } from './ui.js';
import { homeView } from './views/home.js';
import { searchView } from './views/search.js';
import { libraryView } from './views/library.js';
import { settingsView } from './views/settings.js';
import { signIn } from './views/signin.js';

/* The server on the phone can still be starting: it is asked again for a while, and only then the
   page says so (no answer is not the same as signed out, which showed the sign-in to a signed-in
   viewer). */
async function start(tries = 0) {
  const [strings, state] = await Promise.all([api('/app/strings'), api('/app/state')]);
  setTexts(strings);
  if (!state) {
    if (tries < 10) return setTimeout(() => start(tries + 1), 1000);
    return document.body.replaceChildren(
      stateBox(t('noConnectionShort'), t('noConnection'), () => location.reload())
    );
  }
  if (state.language) document.documentElement.lang = state.language;
  if (!state.signedIn) return signIn();
  readPrefs(await api('/app/settings?for=phone'));
  setTabs([
    { id: 'home', icon: ICON.home, label: () => t('navHome'), make: homeView },
    { id: 'search', icon: ICON.search, label: () => t('navSearch'), make: searchView },
    { id: 'library', icon: ICON.library, label: () => t('navLibrary'), make: libraryView },
    { id: 'settings', icon: ICON.settings, label: () => t('navSettings'), make: settingsView }
  ]);
  /* a page asked for in the address (a shared link): ?tab=search|library|settings, ?open=<type>/<id> */
  const ask = new URLSearchParams(location.search),
    tab = ask.get('tab'),
    open = /^([a-z]+)\/([^/]+)$/.exec(ask.get('open') || '');
  if (tab === 'search' || tab === 'library' || tab === 'settings') selectTab(tab);
  if (open) openItem({ type: open[1], id: open[2], name: '' });
}
start();
