/* Settings: the phone's own (/app/settings?for=phone: no TV-only options, no "Ask"), as grouped
   lists; a choice opens the platform's picker, a yes/no is a switch. */
import { api, el, esc, ICON, IOS, readPrefs, t, toast } from '../core.js';
import { makeView } from '../nav.js';
import { chooseFrom, spinner, stateBox } from '../ui.js';

/* the accent belongs to the Android look; iOS keeps the system's colours */
const HIDDEN = IOS ? ['phoneAccent'] : [];

export function settingsView() {
  const title = t('navSettings');
  const v = makeView(title);
  const content = el('<div class="settings"></div>');
  content.appendChild(spinner());
  v.node.appendChild(content);

  const change = async (k, val) => apply(await api('/app/settings', { k, v: val, for: 'phone' }));

  function apply(model) {
    if (!model) return content.replaceChildren(stateBox(t('noConnectionShort'), '', load));
    readPrefs(model);
    const account = model.account || {};
    content.innerHTML = '';
    content.appendChild(
      el(
        `<div class="group account"><div class="cell"><span class="avatar">${esc((account.email || '?')[0].toUpperCase())}</span><span class="label">${esc(account.email || '')}<small>${esc(account.plan || '')}</small></span></div></div>`
      )
    );
    (model.groups || []).forEach((g) => {
      const items = g.items.filter((it) => HIDDEN.indexOf(it.k) < 0);
      if (!items.length) return;
      content.appendChild(el(`<div class="group-title">${esc(g.name)}</div>`));
      const box = el('<div class="group"></div>');
      items.forEach((it) => box.appendChild(cell(it)));
      content.appendChild(box);
    });
  }

  function cell(it) {
    if (it.action) {
      const b = el(
        `<button class="cell${/__logout/.test(it.k) ? ' danger' : ''}"><span class="label">${esc(it.label)}</span>${ICON.chevron.replace('<svg', '<svg class="chev"')}</button>`
      );
      b.onclick = async () => {
        const ans = await api('/app/settings/action', { k: it.k });
        if (ans && ans.message) toast(ans.message);
        if (ans && ans.signedOut) location.reload();
      };
      return b;
    }
    if (it.isSwitch) {
      const b = el(
        `<button class="cell" role="switch" aria-checked="${!!it.on}"><span class="label">${esc(it.label)}</span><span class="switch${it.on ? ' on' : ''}"></span></button>`
      );
      b.onclick = () => {
        const opt = it.options.find((o) => o.v !== it.chosen);
        change(it.k, opt ? opt.v : it.on ? 'false' : 'true');
      };
      return b;
    }
    const b = el(
      `<button class="cell"><span class="label">${esc(it.label)}</span><span class="value">${esc(it.value)}</span>${ICON.chevron.replace('<svg', '<svg class="chev"')}</button>`
    );
    b.onclick = () => chooseFrom(it.label, it.options, it.chosen, (val) => change(it.k, val), title);
    return b;
  }

  async function load() {
    apply(await api('/app/settings?for=phone'));
  }
  load();
  return v;
}
