// A text typed in the middle of the screen: an M3U list's address, an addon's address, or a channel
// to search. Three ways side by side: the app's own keyboard (with keys for addresses), the TV's
// system keyboard on the field itself, and, for addresses, a QR code that opens a page served by
// the TV where the address is pasted from the phone (server/phone-link.js). An M3U panel also
// offers suggested lists of free channels, added with one OK.
var TEXT_KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
var URL_KEYS = ['https://', '.com', '.m3u', '/', ':', '.', '-', '_', '?', '=', '&'];
var textPanel = {
  open: false,
  zone: 'keys',
  keyIdx: 0,
  sugIdx: 0,
  keys: [],
  keyEls: [],
  sugEls: [],
  suggestions: [],
  pollT: null,
  done: null,
  /* opt: { title, hint, url (keys for addresses and the phone QR), suggest (an M3U list),
     done(value) } */
  show: function (opt) {
    var self = this;
    this.opt = opt;
    this.done = opt.done;
    this.open = true;
    this.zone = 'keys';
    this.keyIdx = 0;
    this.sugIdx = 0;
    this.suggestions = [];
    this.keys = (opt.url ? URL_KEYS : []).concat(TEXT_KEYS, ['space', 'del', 'clear', 'ok']);
    $('txTitle').textContent = opt.title;
    $('txHint').textContent = opt.hint || '';
    $('txBox').value = '';
    $('txBox').placeholder = opt.url ? 'https://' : '';
    var host = $('txKeys');
    host.innerHTML = '';
    this.keyEls = [];
    for (var i = 0; i < this.keys.length; i++) {
      var k = this.keys[i],
        el = document.createElement('div');
      el.className = 'skey' + (k.length > 1 ? ' wide' : '');
      el.textContent =
        k === 'space'
          ? tx('keySpace')
          : k === 'del'
            ? tx('keyDelete')
            : k === 'clear'
              ? tx('keyClear')
              : k === 'ok'
                ? 'OK'
                : k;
      host.appendChild(el);
      this.keyEls.push(el);
    }
    $('txPhone').style.display = opt.url ? '' : 'none';
    $('txQr').innerHTML = '';
    $('txPhoneText').textContent = opt.url ? tx('phoneScan') : '';
    $('txSuggest').innerHTML = '';
    $('txSuggestTitle').style.display = 'none';
    $('txPanel').style.display = 'block';
    if (opt.url) this.startPhone();
    if (opt.suggest)
      xhrJson(
        '/app/channels/suggested',
        function (j) {
          if (self.open) self.showSuggestions((j && j.lists) || []);
        },
        20000
      );
    this.paint();
  },
  /* the phone page lives only while this panel is open; it is asked every two seconds */
  startPhone: function () {
    var self = this;
    postJson(
      '/app/phone/start',
      {},
      function (j) {
        if (!self.open) return;
        if (!j || !j.ok) return ($('txPhoneText').textContent = tx('phoneUnavailable'));
        $('txQr').innerHTML = j.svg;
        $('txPhoneUrl').textContent = j.url;
        self.pollPhone();
      },
      8000
    );
  },
  pollPhone: function () {
    var self = this;
    this.pollT = setTimeout(function () {
      xhrJson(
        '/app/phone/poll',
        function (j) {
          if (!self.open) return;
          if (j && j.value) {
            $('txBox').value = j.value;
            return self.submit();
          }
          if (j && j.waiting) self.pollPhone();
        },
        5000
      );
    }, 2000);
  },
  showSuggestions: function (list) {
    this.suggestions = list;
    var host = $('txSuggest');
    host.innerHTML = '';
    this.sugEls = [];
    for (var i = 0; i < list.length; i++) {
      var el = document.createElement('div');
      el.className = 'schip';
      el.textContent = list[i].name;
      host.appendChild(el);
      this.sugEls.push(el);
    }
    $('txSuggestTitle').textContent = tx('suggestedLists');
    $('txSuggestTitle').style.display = list.length ? '' : 'none';
  },
  press: function (k) {
    var box = $('txBox');
    if (k === 'ok') return this.submit();
    if (k === 'del') box.value = box.value.slice(0, -1);
    else if (k === 'clear') box.value = '';
    else box.value += k === 'space' ? ' ' : k;
  },
  submit: function () {
    var value = String($('txBox').value || '').trim(),
      done = this.done;
    if (!value) return;
    this.close();
    done(value);
  },
  close: function () {
    this.open = false;
    if (this.pollT) clearTimeout(this.pollT);
    this.pollT = null;
    if (this.opt && this.opt.url) postJson('/app/phone/stop', {}, function () {}, 4000);
    $('txBox').blur();
    $('txPanel').style.display = 'none';
  },
  paint: function () {
    $('txBox').className = this.zone === 'box' ? 'f' : '';
    setF(this.keyEls, this.zone === 'keys' ? this.keyIdx : -1);
    setF(this.sugEls, this.zone === 'suggest' ? this.sugIdx : -1);
  },
  /* the keys sit 12 to a row */
  key: function (k) {
    var cols = 12,
      n = this.keyEls.length;
    if (this.zone === 'box') {
      if (k === 13) return $('txBox').focus();
      if (k === 40) this.zone = 'keys';
    } else if (this.zone === 'suggest') {
      if (k === 37) this.sugIdx = Math.max(0, this.sugIdx - 1);
      else if (k === 39) this.sugIdx = Math.min(this.sugEls.length - 1, this.sugIdx + 1);
      else if (k === 38) this.zone = 'keys';
      else if (k === 13) {
        $('txBox').value = this.suggestions[this.sugIdx].url;
        return this.submit();
      }
    } else if (k >= 65 && k <= 90) this.press(String.fromCharCode(k + 32));
    else if (k >= 48 && k <= 57) this.press(String(k - 48));
    else if (k === 8) this.press('del');
    else if (k === 13) this.press(this.keys[this.keyIdx]);
    else if (k === 37) this.keyIdx = Math.max(0, this.keyIdx - 1);
    else if (k === 39) this.keyIdx = Math.min(n - 1, this.keyIdx + 1);
    else if (k === 38) {
      if (this.keyIdx < cols) this.zone = 'box';
      else this.keyIdx -= cols;
    } else if (k === 40) {
      if (this.keyIdx + cols < n) this.keyIdx += cols;
      else if (this.sugEls.length) this.zone = 'suggest';
    }
    this.paint();
  }
};
/* the system keyboard on the field: OK sends, Back returns to the app's keys */
on($('txBox'), 'keydown', function (e) {
  if (e.keyCode !== 13 && !isRemoteBack(e.keyCode)) return;
  e.preventDefault();
  e.stopPropagation();
  $('txBox').blur();
  if (e.keyCode === 13) return textPanel.submit();
  textPanel.zone = 'keys';
  textPanel.paint();
});
/* an M3U list's address: the server reads it and keeps it for Channels */
function askM3uList(after) {
  textPanel.show({
    title: tx('m3uAdd'),
    hint: tx('m3uAddress'),
    url: true,
    suggest: true,
    done: function (url) {
      toast(tx('saving'));
      postJson(
        '/app/channels/lists',
        { url: url },
        function (j) {
          toast((j && j.message) || tx('m3uFailed'));
          if (after) after(j && j.ok);
        },
        90000
      );
    }
  });
}
