/* Signing in: continue in the browser (Stremio's link page) or with Nuvio's QR code, or with an
   email and password; then, for a Nuvio account, who is watching (with its PIN when it has one). */
import { $, api, el, enc, esc, ICON, img, t } from '../core.js';
import { hideTabs } from '../nav.js';
import { openSheet, qrSvg, spinner } from '../ui.js';

function page(html) {
  const view = $('#views');
  view.innerHTML = '';
  const node = el(`<section class="view signin-view">${html}</section>`);
  view.appendChild(node);
  return node;
}

export function signIn() {
  hideTabs();
  let provider = 'stremio',
    gen = 0;
  const node = page(`<div class="signin">
    <img class="brand" alt="" src="/logo.png">
    <h1>StremCompat</h1><p>${esc(t('phoneLoginHint'))}</p>
    <div class="segmented"><button class="on" data-p="stremio">Stremio</button><button data-p="nuvio">Nuvio</button></div>
    <div class="link-box"></div>
    <div class="or"><span>${esc(t('emailSignIn'))}</span></div>
    <input class="field email" type="email" inputmode="email" autocomplete="username" placeholder="${esc(t('email'))}">
    <input class="field password" type="password" autocomplete="current-password" placeholder="${esc(t('password'))}">
    <div class="error" role="alert"></div>
    <button class="btn primary block go">${esc(t('signIn'))}</button>
    <p class="note">${esc(t('accountNote'))}</p></div>`);
  node.querySelectorAll('.segmented button').forEach((b) => {
    b.onclick = () => {
      provider = b.dataset.p;
      node.querySelectorAll('.segmented button').forEach((x) => x.classList.toggle('on', x === b));
      linkBox();
    };
  });
  $('.go', node).onclick = async () => {
    const go = $('.go', node);
    $('.error', node).textContent = '';
    go.disabled = true;
    const ans = await api('/app/login/email', {
      email: $('.email', node).value,
      password: $('.password', node).value,
      provider
    });
    go.disabled = false;
    if (ans && ans.done) return signedIn(ans);
    $('.error', node).textContent = (ans && ans.error) || t('signInFailed');
  };

  /* Stremio: a button to its link page in the browser. Nuvio: its QR code (for another phone)
     and the same link. Both are asked about until approved. */
  async function linkBox() {
    const mine = ++gen,
      box = $('.link-box', node);
    box.replaceChildren(spinner());
    const code = await api(`/app/login/start?provider=${provider}`);
    if (mine !== gen) return;
    if (!code || code.error) return (box.innerHTML = `<div class="note">${esc(t('qrUnavailable'))}</div>`);
    box.innerHTML = `${provider === 'nuvio' ? `<div class="qr-box">${qrSvg(code.qr)}<span>${esc(t('scanCode'))}</span></div>` : ''}
      <a class="btn tonal block" href="${esc(code.link)}" target="_blank" rel="noopener">${ICON.globe}<span>${esc(t('continueInBrowser'))}</span></a>
      <div class="hint">${esc(t('browserApproveHint'))} · <b>${esc(code.code)}</b></div>`;
    poll(mine, code);
  }
  async function poll(mine, code) {
    await new Promise((r) => setTimeout(r, (code.every || 3) * 1000));
    if (mine !== gen || !document.body.contains(node)) return;
    const ans = await api(`/app/login/poll?provider=${provider}&id=${enc(code.id)}`);
    if (mine !== gen) return;
    if (ans && ans.done) return signedIn(ans);
    if (ans && ans.expired) return linkBox();
    poll(mine, code);
  }
  linkBox();
}

function signedIn(ans) {
  if (ans.profiles) return profiles();
  location.reload();
}

/* ---------- who is watching (Nuvio) ---------- */
async function profiles() {
  const node = page(
    `<div class="profiles"><h1>${esc(t('whoIsWatching'))}</h1><div class="faces"></div></div>`
  );
  const faces = $('.faces', node);
  faces.appendChild(spinner());
  const ans = await api('/app/profiles');
  if (!ans || !ans.profiles) return location.reload();
  faces.innerHTML = '';
  ans.profiles.forEach((p) => {
    const b = el(`<button class="face">
      <span class="avatar" style="background:${esc(p.color)}">${p.avatar ? `<img alt="" src="${esc(img(p.avatar, 96))}">` : esc((p.name || '?')[0].toUpperCase())}</span>
      <span class="name">${esc(p.name || t('profileNumber', p.index))}</span>${p.locked ? `<span class="lock" aria-label="${esc(t('profileLocked'))}">${ICON.lock}</span>` : ''}</button>`);
    b.onclick = () => (p.locked ? askPin(p) : choose(p, ''));
    faces.appendChild(b);
  });
}

async function choose(p, pin) {
  const ans = await api(`/app/profile?index=${p.index}&pin=${enc(pin)}`);
  if (ans && ans.ok) location.reload();
  return ans || { ok: false };
}

/* the PIN typed by the viewer on the phone's number pad */
function askPin(p) {
  const body = el(`<div class="pin">
    <div class="sheet-head"><h3>${esc(t('pinEnter', p.name))}</h3></div>
    <input class="field pin-field" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off">
    <div class="error" role="alert"></div>
    <button class="btn primary block">${esc(t('keyboardDone'))}</button></div>`);
  openSheet(body);
  const field = $('.pin-field', body);
  setTimeout(() => field.focus(), 250);
  const go = async () => {
    const ans = await choose(p, field.value);
    if (ans.ok) return;
    field.value = '';
    $('.error', body).textContent = ans.retryAfter ? t('pinWait', ans.retryAfter) : t('pinWrong');
  };
  $('button', body).onclick = go;
  field.addEventListener('input', () => field.value.length === 4 && go());
}
