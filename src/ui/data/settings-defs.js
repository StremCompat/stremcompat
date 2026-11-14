// What Settings offers, in groups, and how a value is read and kept; shared by the web
// Settings screen and the native interface.
function mediaLanguageOptions() {
  return [
    ['', tx('disabled')],
    ['por', tx('portugueseBrazil')],
    ['eng', tx('english')],
    ['spa', tx('spanish')],
    ['fre', tx('french')],
    ['ita', tx('italian')],
    ['ger', tx('german')],
    ['ara', tx('arabic')],
    ['rus', tx('russian')],
    ['tur', tx('turkish')],
    ['pol', tx('polish')],
    ['dut', tx('dutch')],
    ['swe', tx('swedish')],
    ['heb', tx('hebrew')],
    ['hin', tx('hindi')],
    ['jpn', tx('japanese')],
    ['kor', tx('korean')],
    ['chi', tx('chinese')]
  ];
}
/* an option that is only on or off is drawn as a switch, and OK flips it */
function isSwitch(def) {
  return (
    !!def.opts &&
    def.opts.length === 2 &&
    /^(true|false)$/.test(def.opts[0][0]) &&
    /^(true|false)$/.test(def.opts[1][0])
  );
}
/* one recorded problem as '14:32 · Source would not play (Torrentio 1080p)' */
function diagEventLine(e) {
  var d = new Date(e.at),
    hh = (d.getHours() < 10 ? '0' : '') + d.getHours(),
    mm = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(),
    key = {
      media_error: 'evMediaError',
      media_start_retry: 'evSlowStart',
      streamref_failed: 'evPrepareFailed',
      play_rejected: 'evPlayRejected',
      addon_unavailable: 'evAddonDown',
      network_unreachable: 'evNoNetwork'
    }[e.kind];
  return hh + ':' + mm + '  ·  ' + tx(key || e.kind) + (e.detail ? ' (' + e.detail + ')' : '');
}
/* running or stopped; the engine itself only runs while a torrent plays */
function diagStreamingState(j) {
  var f = j.torrentEngine || {};
  if (j.serverAddress)
    return j.serverAddress + '  ·  ' + tx(j.streamingServer ? 'diagRunning' : 'diagStopped');
  if (f.state === 'failed') return tx('diagStreamFailed', 'sc-engine');
  if (f.state === 'no-room') return tx('torrentsNoRoom');
  var where = f.usb ? '  ·  ' + tx('diagOnUsb') : '',
    cache = f.cacheMb != null && f.cacheCapMb ? '  ·  ' + tx('diagCache', f.cacheMb, f.cacheCapMb) : '';
  return tx(f.running ? 'diagRunning' : 'diagEngineReady') + where + cache;
}
/* the groups of Settings, each with its options: what this TV and this account can use */
function settingsCategories() {
  var defs,
    langOpts = mediaLanguageOptions(),
    audioOpts = langOpts.slice(1),
    backupOpts = [['', tx('none')]].concat(audioOpts);
  defs = [
    { head: tx('playbackGroup'), id: 'playback' },
    {
      k: 'preferredSourceQuality',
      lb: tx('preferredQuality'),
      opts: [
        ['Ask', tx('qualityAsk')],
        ['Auto', tx('automatic')],
        ['4K', '4K'],
        ['1080p', '1080p'],
        ['720p', '720p'],
        ['SD', 'SD']
      ],
      d: 'Ask'
    },
    {
      k: 'preferredSourceLanguage',
      lb: tx('preferredLanguage'),
      opts: [
        ['Ask', tx('qualityAsk')],
        ['Auto', tx('anyLanguage')]
      ].concat(SOURCE_LANGUAGES),
      d: 'Ask'
    },
    {
      k: 'bingeWatch',
      lb: tx('nextEpisode'),
      opts: [
        ['true', tx('enabled')],
        ['false', tx('disabled')]
      ],
      d: 'true'
    },
    {
      k: 'seekStep',
      lb: tx('seekInterval'),
      opts: [
        ['5', '5s'],
        ['10', '10s'],
        ['15', '15s'],
        ['20', '20s'],
        ['30', '30s']
      ],
      d: '10'
    },
    {
      k: 'scrubPreview',
      lb: tx('scrubPreview'),
      opts: [
        ['true', tx('enabled')],
        ['false', tx('disabled')]
      ],
      d: 'false'
    },
    { head: tx('subtitlesGroup'), id: 'subtitles' },
    { k: 'subsLang', lb: tx('defaultLanguage'), opts: langOpts, d: defaultMediaLanguage() },
    { k: 'subsLang2', lb: tx('backupLanguage'), opts: backupOpts, d: '' },
    {
      k: 'subtitleSize',
      lb: tx('subtitleSize'),
      opts: [
        ['0', '72%'],
        ['1', '80%'],
        ['2', '100%'],
        ['3', '120%'],
        ['4', '140%'],
        ['5', '160%'],
        ['6', '180%']
      ],
      d: '2'
    },
    {
      k: 'subsColor',
      lb: tx('subtitleColor'),
      opts: [
        ['#ffffff', tx('white')],
        ['#ffe600', tx('yellow')],
        ['#00e5ff', tx('cyan')]
      ],
      d: '#ffffff'
    },
    {
      k: 'subsOutlineColor',
      lb: tx('subtitleOutline'),
      opts: [
        ['#000000', tx('black')],
        ['#ffffff', tx('white')]
      ],
      d: '#000000'
    },
    {
      k: 'subsBgStyle',
      lb: tx('subtitleBackground'),
      opts: [
        ['0', tx('none')],
        ['1', tx('solid')],
        ['.6', tx('transparent')]
      ],
      d: '0'
    },
    {
      k: 'assStyle',
      lb: tx('assStyle'),
      opts: [
        ['false', tx('disabled')],
        ['true', tx('enabled')]
      ],
      d: 'false'
    },
    {
      k: 'embSubsMode',
      lb: tx('embeddedSubtitles'),
      opts: [
        ['server', tx('extractRecommended')],
        ['native', tx('tvNative')]
      ],
      d: 'server'
    },
    { head: tx('audioGroup'), id: 'audio' },
    {
      k: 'enableDefaultAudioTrack',
      lb: tx('autoAudio'),
      opts: [
        ['true', tx('enabled')],
        ['false', tx('disabled')]
      ],
      d: 'false'
    },
    { k: 'defaultAudioTrack', lb: tx('defaultAudio'), opts: audioOpts, d: defaultMediaLanguage() },
    { k: 'defaultAudioTrack2', lb: tx('backupLanguage'), opts: backupOpts, d: '' },
    { head: tx('interfaceGroup'), id: 'interface' },
    {
      k: UI_LANG_KEY,
      lb: tx('interfaceLanguage'),
      opts: Object.keys(UI_LANGUAGES).map(function (code) {
        return [code, UI_LANGUAGES[code]];
      }),
      d: UI_LANG
    },
    {
      k: 'uiMode',
      lb: tx('uiModeLabel'),
      opts: [
        ['full', tx('modeFull')],
        ['simple', tx('modeSimple')]
      ],
      d: 'full'
    },
    {
      k: 'uiLook',
      lb: tx('uiLookLabel'),
      opts: [
        ['standard', tx('lookStandard')],
        ['light', tx('lookLight')]
      ],
      d: uiLook()
    },
    {
      k: 'uiTextSize',
      lb: tx('interfaceTextSize'),
      opts: [
        ['normal', tx('textNormal')],
        ['large', tx('textLarge')]
      ],
      d: 'normal'
    },
    {
      k: 'episodeDates',
      lb: tx('episodeAirDates'),
      opts: [
        ['false', tx('disabled')],
        ['true', tx('enabled')]
      ],
      d: 'true'
    },
    {
      k: 'bgTrailer',
      lb: tx('backgroundTrailers'),
      opts: [
        ['false', tx('disabled')],
        ['true', tx('enabled')]
      ],
      d: 'false'
    },
    { k: '__rows', lb: tx('organizeCatalogs'), action: true },
    { k: '__m3u', lb: tx('m3uAdd'), action: true },
    { head: tx('accountGroup'), id: 'account' },
    { k: '__profile', lb: tx('nuvioProfile'), action: true },
    { k: '__sync', lb: tx('syncAddons'), action: true },
    { head: tx('historyGroup'), id: 'history' },
    {
      k: 'noHistory',
      lb: tx('noHistory'),
      opts: [
        ['false', tx('disabled')],
        ['true', tx('enabled')]
      ],
      d: 'false'
    },
    { k: '__clearSearches', lb: tx('clearSearches'), action: true },
    { k: '__clearCw', lb: tx('clearCw'), action: true },
    { k: '__showNew', lb: tx('showHiddenNewEpisodes'), action: true },
    {
      k: 'torrentsOnUsb',
      lb: tx('torrentsOnUsb'),
      opts: [
        ['false', tx('disabled')],
        ['true', tx('enabled')]
      ],
      d: 'false'
    },
    { k: '__clearCache', lb: tx('clearTorrentCache'), action: true },
    { head: tx('maintenanceGroup'), id: 'maintenance' },
    { k: '__server', lb: tx('serverAddress'), action: true, info: true },
    { k: '__diag', lb: tx('diagnostics'), action: true },
    { k: '__speed', lb: tx('testConnection'), action: true },
    { k: '__reload', lb: tx('reloadApp'), action: true },
    { head: tx('supportGroup'), id: 'support' },
    { k: '__support', lb: tx('supportCoffee'), action: true },
    { head: tx('signOut'), id: 'logout' },
    { k: '__logout', lb: tx('signOut'), action: true }
  ];
  /* profiles exist only on Nuvio accounts */
  if (!isNuvioAccount())
    defs = defs.filter(function (d) {
      return d.k !== '__profile';
    });
  /* Simple keeps what most people change: languages, subtitle size, the look and the account */
  if (simpleMode()) {
    var essential =
      /^(subsLang|subsLang2|subtitleSize|enableDefaultAudioTrack|defaultAudioTrack|bingeWatch|preferredSourceQuality|uiLanguage|uiMode|uiLook|uiTextSize|__profile|__logout|__diag|__reload|__support)$/;
    defs = defs.filter(function (d) {
      return d.head || essential.test(d.k || '');
    });
    /* a heading with nothing under it goes too */
    defs = defs.filter(function (d, i, all) {
      return !d.head || (all[i + 1] && !all[i + 1].head);
    });
  }
  /* these depend on FFmpeg or on memory only the LG packages can spare */
  if (!HAS_MEDIA_TOOLS)
    for (var nf = defs.length - 1; nf >= 0; nf--)
      if (/^(scrubPreview|embSubsMode|bgTrailer|torrentsOnUsb|__clearCache)$/.test(defs[nf].k || ''))
        defs.splice(nf, 1);
  var cats = [];
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    if (def.head) cats.push({ name: def.head, id: def.id || '', items: [] });
    else if (cats.length) cats[cats.length - 1].items.push(def);
  }
  cats = cats.filter(function (c) {
    return c.items.length;
  });
  return cats;
}
/* the name of the value in use */
function settingValueLabel(def) {
  var cur = lsRaw(def.k, def.d);
  for (var i = 0; i < def.opts.length; i++) if (def.opts[i][0] === cur) return def.opts[i][1];
  return def.opts[0][1];
}
/* keeps a value; Next episode also sets what the player reads for it */
function storeSetting(def, value) {
  lsRawSet(def.k, value);
  if (def.k === 'bingeWatch') lsRawSet('enableNextVideo', value);
}
