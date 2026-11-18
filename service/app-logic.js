// The interface's data logic without its screens, for the native interface: the local server
// runs it (server/app-runtime.js) with its own localStorage, XMLHttpRequest and window, so
// both interfaces share one tested copy of accounts, addons, catalogs, sources and library.
(function () {
'use strict';
/* What the data code tells the screens when something changed. The native interface asks the
   server again instead, so these stand in for the web screens. */
function invalidateBoards() {}
var search = {};
/* what the web interface would show as a toast, kept for the native one to show */
var lastMessage = '';
function toast(message) {
  lastMessage = message;
}
// Service endpoints, the build profile, viewport metrics and DOM/event helpers.
/* ================= utils ================= */
var CIN = 'https://v3-cinemeta.strem.io';
var API = 'https://api.strem.io';
/* Injected by local-server.js from the build profile; the fallback is the webOS 4 1920x1080 profile. */
var TV_PROFILE = window.__SC_PROFILE__ || {
  id: 'um4-armv7',
  serviceId: 'io.github.alexesmm.legacytv.server',
  lowMemory: false,
  sourceCap: 60,
  libraryCap: 1000,
  catalogCap: 16,
  catalogRowsCap: 24,
  discoverCap: 80
};
function $(id) {
  return document.getElementById(id);
}
function viewportWidth() {
  var d = document.documentElement;
  return Math.max(640, (d && d.clientWidth) || window.innerWidth || 1920);
}
function contentWidth() {
  var d = document.documentElement,
    h = (d && d.clientHeight) || window.innerHeight || 1080;
  return viewportWidth() - (h <= 800 ? 112 : 176);
}
function on(target, name, handler, capture) {
  if (!target) return false;
  try {
    if (typeof target.addEventListener === 'function') {
      target.addEventListener(name, handler, !!capture);
      return true;
    }
    if (typeof target.attachEvent === 'function') {
      target.attachEvent('on' + name, function () {
        handler(window.event);
      });
      return true;
    }
    target['on' + name] = handler;
    return true;
  } catch (e) {
    try {
      target['on' + name] = handler;
      return true;
    } catch (ignore) {
      return false;
    }
  }
}
function bodyHas(name) {
  return (' ' + document.body.className + ' ').indexOf(' ' + name + ' ') >= 0;
}
function bodyAdd(name) {
  if (!bodyHas(name)) document.body.className += (document.body.className ? ' ' : '') + name;
}
function bodyRemove(name) {
  document.body.className = (' ' + document.body.className + ' ')
    .replace(new RegExp(' ' + name + ' ', 'g'), ' ')
    .replace(/^\s+|\s+$/g, '');
}
// What differs between TV platforms, LG webOS here. src/platform/tizen has the same functions;
// the build picks one folder per platform, in both the interface and the player.
/* FFmpeg and FFprobe run on this platform: reduced artwork, technical badges, seek previews
   and subtitle extraction are available */
var HAS_MEDIA_TOOLS = true;
/* where a path of the app really is; on webOS the pages come from the local server */
function appUrl(path) {
  return path;
}
/* Back on the remote, for text boxes too (where 8 is the Delete key of the keyboard) */
function isRemoteBack(k) {
  return k === 461 || k === 27;
}
function isBackKey(k) {
  return isRemoteBack(k) || k === 8;
}
/* cb(true) when the system answered, cb(false) if it did not; the service may need a moment
   more before it listens */
function startService(serviceId, cb) {
  var done = false,
    bridge = null;
  function finish(ok) {
    if (done) return;
    done = true;
    bridge = null;
    cb(ok);
  }
  try {
    if (typeof PalmServiceBridge === 'undefined') {
      finish(false);
      return;
    }
    bridge = new PalmServiceBridge();
    bridge.onservicecallback = function () {
      finish(true);
    };
    bridge.call('luna://' + serviceId + '/start', '{}');
    setTimeout(function () {
      finish(false);
    }, 2600);
  } catch (e) {
    finish(false);
  }
}
// XHR helpers. Addon GETs and Stremio API POSTs go through the local bridges in local-server.js.
/* The TV's browser opens at most six connections to one address, and a stream addon can take 45 s
   to answer. Requests that may wait that long take a second lane: the same local server under its
   other loopback name (localhost for 127.0.0.1), so pages and pictures never queue behind them.
   When that name does not work on a TV, the lane is dropped for the rest of the session. */
var slowLaneOff = false;
function slowLane() {
  if (slowLaneOff || typeof location === 'undefined' || !location.port) return '';
  var other =
    location.hostname === '127.0.0.1' ? 'localhost' : location.hostname === 'localhost' ? '127.0.0.1' : '';
  return other ? location.protocol + '//' + other + ':' + location.port : '';
}
function xhrGetUrl(u, lane) {
  return /^https?:\/\//i.test(String(u || '')) ? (lane || '') + '/addon?u=' + encodeURIComponent(u) : u;
}
/* cb(json, failure, status): failure is null on success, otherwise 'timeout', 'offline'
   (the local service did not answer), 'unavailable' (HTTP error, e.g. the addon
   bridge's 502) or 'invalid' (the body was not JSON); status is the HTTP status. slow sends it by
   the second lane (slowLane). */
function xhrJson(u, cb, tmo, slow) {
  var done = false,
    lane = slow ? slowLane() : '';
  try {
    var x = new XMLHttpRequest();
    x.open('GET', xhrGetUrl(u, lane), true);
    x.onreadystatechange = function () {
      if (x.readyState === 4 && !done) {
        done = true;
        /* the other name did not reach the server: the usual way, from now on */
        if (lane && !x.status) {
          slowLaneOff = true;
          xhrJson(u, cb, tmo);
          return;
        }
        var j = null,
          failure = null;
        if (!x.status) failure = 'offline';
        else if (x.status >= 400) failure = 'unavailable';
        try {
          j = JSON.parse(x.responseText);
        } catch (e) {
          failure = failure || 'invalid';
        }
        cb(failure ? null : j, failure, x.status);
      }
    };
    x.send();
    setTimeout(function () {
      if (!done) {
        done = true;
        try {
          x.abort();
        } catch (e) {}
        cb(null, 'timeout');
      }
    }, tmo || 14000);
    return x;
  } catch (e) {
    cb(null, 'offline');
    return null;
  }
}
/* After a request failed: asks the local server whether Stremio answers at all, so the
   screen can say the TV has no connection instead of a vague error. cb(code) gets the
   network error (such as ENOTFOUND or ETIMEDOUT), or '' when Stremio is reachable or
   the local server itself did not answer. Never runs while things work. */
function checkConnection(cb) {
  xhrJson(
    '/netcheck',
    function (j) {
      cb(j && j.ok === false ? String(j.code || 'ERROR') : '');
    },
    15000
  );
}
function apiPostUrl(u) {
  var p = API + '/api/';
  return String(u || '').indexOf(p) === 0
    ? '/stremioapi?path=' + encodeURIComponent(String(u).slice(API.length))
    : u;
}
function postJson(u, body, cb, tmo) {
  var done = false;
  try {
    var x = new XMLHttpRequest();
    x.open('POST', apiPostUrl(u), true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState === 4 && !done) {
        done = true;
        var j = null;
        try {
          j = JSON.parse(x.responseText);
        } catch (e) {}
        cb(j);
      }
    };
    x.send(JSON.stringify(body));
    setTimeout(function () {
      if (!done) {
        done = true;
        try {
          x.abort();
        } catch (e) {}
        cb(null);
      }
    }, tmo || 14000);
  } catch (e) {
    cb(null);
  }
}
// localStorage access that never throws (storage can be unavailable on old webOS).
function lsJson(k) {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch (e) {
    return null;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
}
function lsRaw(k, d) {
  try {
    var v = localStorage.getItem(k);
    return v == null ? d : v;
  } catch (e) {
    return d;
  }
}
function lsRawSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch (e) {}
}
function storageKeys() {
  var out = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k != null) out.push(k);
    }
  } catch (e) {}
  return out;
}
/* The saved copies of catalogs and Discover pages are good for a week; older ones are dropped,
   once a day, so the TV's storage never fills up (a full storage loses settings too) */
var CACHE_KEEP_MS = 7 * 24 * 3600 * 1000;
function pruneCaches() {
  if (Date.now() - parseInt(lsRaw('cachesPruned', '0'), 10) < 24 * 3600 * 1000) return;
  lsRawSet('cachesPruned', String(Date.now()));
  var keys = storageKeys();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('beta_cat_') !== 0 && keys[i].indexOf('beta_discover_v3_') !== 0) continue;
    var v = lsJson(keys[i]);
    if (!v || !v.t || Date.now() - v.t > CACHE_KEEP_MS)
      try {
        localStorage.removeItem(keys[i]);
      } catch (e) {}
  }
}
// Interface and player strings, shared by both bundles. English and Portuguese are built in; the
// others are service/lang/<code>.json, read only when chosen, so a TV holds just its own language.
/* Adding a language means adding its file and its name in UI_LANGUAGES: the interface reads it
   with tx(), the player through playerText() in src/player/strings.js. */
/* Interface language is deliberately local to the television. It does not follow
   the Stremio account and it does not change subtitle/audio preferences. English is
   the reliable first-run and fallback language; Portuguese remains an explicit choice. */
var UI_LANG_KEY = 'uiLanguage';
var UI_TEXT = {
  'en-US': {
    navSearch: 'Search',
    navHome: 'Home',
    navDiscover: 'Discover',
    navLibrary: 'Library',
    navAddons: 'Addons',
    navSettings: 'Settings',
    searchPlaceholder: 'Search movies and series',
    searchHint: 'Type with the keyboard; results appear as you type',
    searching: 'Searching…',
    noResults: 'No results for “{0}”',
    movies: 'Movies',
    series: 'Series',
    anime: 'Anime',
    movie: 'Movie',
    seriesOne: 'Series',
    other: 'Other',
    all: 'All',
    recent: 'Recent',
    recentSearches: 'Recent searches',
    seeAll: 'See all ›',
    seeAllHint: 'Open the whole catalog in Discover',
    keySpace: 'space',
    keyDelete: 'delete',
    keyClear: 'clear',
    clearHistory: 'Clear history',
    removeFromCw: 'Remove from Continue watching',
    exitTitle: 'Leave StremCompat?',
    exitSub: 'Choose an option',
    exitStay: 'Stay',
    exitLeave: 'Leave the app',
    removedFromCw: 'Removed from Continue watching',
    torrentsNeedServer: 'This TV cannot run torrents by itself. Set a server in Settings > Streaming server.',
    serverAddress: 'Address',
    serverHere: 'This TV',
    serverTitle: 'Streaming server address',
    serverHint: 'Used for torrents. Example: 192.168.0.10:11470',
    serverDelete: 'Delete',
    serverClear: 'Clear',
    serverUseTv: 'Use this TV',
    serverSave: 'Test and save',
    serverTesting: 'Testing the connection…',
    serverSaved: 'Streaming server saved',
    serverLocal: 'Using the server on this TV',
    serverInvalid: 'Check the address',
    serverUnreachable: 'No streaming server answered at this address',
    serverDisk: 'Could not save the address',
    historyGroup: 'History',
    noHistory: 'Do not save history',
    episodeAirDates: 'Air dates on episodes',
    clearSearches: 'Clear recent searches',
    clearCw: 'Clear Continue watching',
    confirmAgain: 'Press OK again to confirm',
    searchesCleared: 'Recent searches cleared',
    cwCleared: 'Continue watching cleared ({0})',
    nothingToClear: 'Nothing to clear',
    holdOkHint: 'Tip: hold OK on a title for more options',
    discoverTitle: 'Discover',
    popular: 'Popular',
    topRated: 'Top rated',
    allGenres: 'All genres',
    popularMovies: 'Popular · Movies',
    popularSeries: 'Popular · Series',
    topMovies: 'Top rated · Movies',
    topSeries: 'Top rated · Series',
    trendingMovies: 'Trending · Movies',
    trendingSeries: 'Trending · Series',
    continueWatching: 'Continue watching',
    myList: 'My list',
    newEpisodes: 'New episodes',
    newEpisodeTag: 'New · S{0} E{1}',
    cwUpNext: 'Up next · S{0} E{1}',
    cwEpisode: 'S{0} E{1}',
    cwLeft: '{0} min left',
    badgeSoon: 'Coming soon',
    badgeNew: 'New',
    emptyLibraryTitle: 'Your library is empty',
    emptyLibraryHint: 'Hold OK on any title and choose Add to Library.',
    nothingFoundHint: 'Try another catalog or genre.',
    similarEmptyHint: 'This title has no similar suggestions yet.',
    noResultsHint: 'Try another name, fewer words or the original title.',
    interfaceTextSize: 'Interface text',
    textNormal: 'Normal',
    textLarge: 'Larger',
    loadingTrailer: 'Loading trailer…',
    trailerUnavailable: 'Trailer unavailable',
    trailerInYoutube: 'Opening the trailer in the YouTube app',
    noTrailer: 'No trailer available',
    continueLabel: 'Continue',
    continueEpisode: 'Continue S{0} E{1}',
    playEpisode: 'Play S{0} E{1}',
    watch: 'Watch',
    details: 'Details',
    similarTitles: 'More like this',
    trailer: 'Trailer',
    markWatched: 'Mark as watched',
    markedWatched: 'Marked as watched',
    markUnwatched: 'Mark as unwatched',
    markedUnwatched: 'Marked as unwatched',
    markSeasonWatched: 'Mark season as watched',
    markSeasonUnwatched: 'Mark season as unwatched',
    removeLibrary: 'Remove from Library',
    addLibrary: 'Add to Library',
    removedLibrary: 'Removed from Library',
    addedLibrary: 'Added to Library',
    inLibrary: 'In Library',
    libraryButton: 'Library',
    similar: 'Similar',
    similarTo: 'More like {0}',
    findingSimilar: 'Finding similar titles…',
    nothingFound: 'Nothing found.',
    couldNotLoad: 'Could not load title',
    specials: 'Specials',
    season: 'Season {0}',
    episode: 'Episode {0}',
    seasonEpisode: 'Season {0} · Episode {1}',
    absoluteEpisode: 'Episode {0} overall',
    seasonAbsoluteEpisode: 'Season {0} · Episode {1} · Episode {2} overall',
    seasonOrder: 'By season',
    continuousOrder: 'Continuous order',
    previous: 'Previous',
    next: 'Next',
    episodeRange: 'Episodes {0}–{1}',
    goToEpisode: 'Go to episode',
    episodeNumberPrompt: 'Enter the overall episode number',
    episodeNotFound: 'Episode not found',
    jumpDelete: 'Delete',
    jumpGo: 'Go',
    jumpHint: 'Use the arrows and OK. Back cancels.',
    sources: 'Sources',
    findingSources: 'Finding sources…',
    noSources: 'No sources found.',
    noSourcesQuality: 'No sources in this quality.',
    addonsNoAnswer: 'No answer from: {0}',
    tryingNextSource: 'Trying the next source…',
    noOtherSource: 'No other source to try',
    catalogsFailed: 'No catalog could be loaded. Check the connection and your addons.',
    playBest: 'Best source',
    directedBy: 'Directed by {0}',
    sourceLanguageRow: 'Audio: {0}',
    bestAudioHint: 'Sources with {0} audio first. Subtitles are chosen later, in the player.',
    bestAudioAny: 'Any audio language. Subtitles are chosen later, in the player.',
    audioLanguageTitle: 'Audio language',
    audioLanguageSub:
      'Sources dubbed in this language come first. Subtitles are chosen later, in the player.',
    anyAudioLanguage: 'Any language',
    sourcesButton: 'All sources',
    seeDetails: 'See details',
    playingBest: 'Playing the best source: {0}',
    updateAvailable: 'StremCompat {0} is available. Update it in the Homebrew Channel.',
    updateNav: 'Update',
    updateTitle: 'StremCompat {0} is available',
    updateSub: 'It installs over this version and keeps your account and settings.',
    updateNow: 'Update now',
    updateLater: 'Later',
    updateStarting: 'Downloading the update…',
    updateProgress: 'Downloading the update… {0}%',
    updateInstalling: 'Installing the update. StremCompat will close and open again.',
    updateElsewhere: 'Could not update from here. Update StremCompat in the Homebrew Channel.',
    whatsNew: 'Updated to StremCompat {0}.',
    lastStartStopped:
      'The last time, StremCompat stopped while starting (step {0}). If it happens again, mention this step in your report.',
    setupUseQuestion: 'How do you want to use StremCompat?',
    modeSimple: 'Simple',
    modeSimpleHint: 'Only the essentials in Settings and in the player. The best source in one press.',
    modeFull: 'Complete',
    modeFullHint: 'Every option, as before.',
    setupLookQuestion: 'Which look?',
    lookLight: 'Light',
    lookLightHint: 'No effects and smaller images. Best for webOS 3 and TVs with little memory.',
    setupSkip: 'Skip',
    setupHint: 'You can change this later in Settings.',
    uiModeLabel: 'How the app is used',
    uiLookLabel: 'Look',
    lookStandard: 'Standard',
    lookStandardHint: 'Recommended for most TVs. The look of earlier versions.',
    providerNuvio: 'Nuvio',
    whoIsWatching: 'Who is watching?',
    profileNumber: 'Profile {0}',
    profileLocked: 'Protected with a PIN',
    addProfile: 'Add profile',
    editProfile: 'Edit profile',
    profileName: 'Name',
    profileNameNeeded: 'Give the profile a name',
    profileNotSaved: 'Could not save the profile on Nuvio',
    pinEnter: 'Enter the PIN for {0}',
    pinWrong: 'Wrong PIN',
    pinWait: 'Too many tries. Try again in {0} s',
    pinNew: 'Choose a 4-digit PIN',
    pinCurrent: 'Enter the current PIN',
    pinSet: 'Set PIN',
    pinRemove: 'Remove PIN',
    pinSaved: 'PIN saved',
    pinRemoved: 'PIN removed',
    pinNotSaved: 'Could not change the PIN on Nuvio',
    pinDelete: 'Delete',
    watchAgain: 'Watch again',
    retry: 'Try again',
    nothingHere: 'Nothing here yet',
    moreText: 'More',
    titleUnavailable: 'This title couldn\'t be loaded',
    watchedShort: 'Watched',
    episodesTitle: 'Episodes',
    searchInSources: 'Search in sources',
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    openInOtherApp: 'Open in another app',
    loadingText: 'Loading…',
    sortBy: 'Sort',
    sortRecent: 'Recently added',
    sortAZ: 'Name (A–Z)',
    upcomingShort: 'Upcoming',
    emptyLibraryPhone: 'Press and hold any title and choose Add to Library.',
    phoneLoginHint: 'Sign in to see your library and addons.',
    continueInBrowser: 'Continue in the browser',
    browserApproveHint: 'Approve on the page that opens, then come back',
    phoneGroup: 'Phone',
    accentColor: 'Accent color',
    accent_violet: 'Violet',
    accent_crimson: 'Crimson',
    accent_ocean: 'Ocean',
    accent_emerald: 'Emerald',
    accent_amber: 'Amber',
    accent_rose: 'Rose',
    accent_white: 'White',
    playBestAutomatically: 'Play the best source automatically',
    playerChoice: 'Player',
    playerBuiltIn: 'Built in',
    playerExternal: 'Another app (VLC, MX Player…)',
    phoneSearchTitle: 'Search on the TV',
    phoneSearchHint: 'Scan to type the search on your phone',
    screensaverSetting: 'Screensaver',
    minutesN: '{0} minutes',
    filterCached: 'Cached',
    filterHdr: 'HDR',
    filterAtmos: 'Atmos',
    filterRemux: 'Remux',
    filterNoCam: 'No CAM',
    markSeriesWatched: 'Mark series as watched',
    markSeriesUnwatched: 'Mark series as unwatched',
    spoilersSetting: 'Spoilers',
    spoilersShow: 'Show everything',
    spoilersPictures: 'Blur unwatched pictures',
    spoilersAll: 'Hide pictures and synopses',
    spoilerHidden: 'Synopsis hidden until you watch this episode.',
    upcomingRow: 'Upcoming episodes',
    upcomingTag: 'S{0} E{1} · {2}',
    forcedSubsSetting: 'Forced subtitles only',
    skipIntroSetting: 'Skip intro and recap',
    skipOnOk: 'With OK',
    skipByItself: 'By itself',
    endsAt: 'Ends at {0}',
    nextCardHint: 'OK to play it now · Back to keep watching',
    cachedTag: 'Cached',
    audioNotPlayable: 'This TV can\'t play this audio. Try another audio track or source.',
    addonsLeft: 'Still answering: {0}',
    notOnThisTv: 'Didn\'t play on this TV: {0}',
    folderAddonMissing: 'Install the {0} addon in Nuvio to see this list.',
    folderLists: '{0} lists',
    folderExplore: 'OK to explore',
    discoverMaxLabel: 'Titles in Discover',
    discoverMax80: '80 (weaker TVs)',
    discoverMax200: '200 (standard)',
    discoverMax500: '500 (TVs with more memory)',
    pointerLabel: 'Magic Remote pointer',
    folderAll: 'All',
    folderSourceUnavailable: 'This source comes from TMDB or Trakt, which only Nuvio’s own app can open.',
    store_all: 'All',
    store_streams: 'Movies and series',
    store_channels: 'Channels',
    store_subtitles: 'Subtitles',
    store_catalogs: 'Catalogs',
    storeConfigure: 'Configure on your phone',
    storeConfigureHint: 'This addon has to be set up first. Scan the code, set it up on your phone, then add it here with "Add by address" (the phone can send the address too).',
    m3uManage: 'Manage lists',
    noLists: 'No M3U list added yet',
    liveLabel: 'LIVE',
    m3uRemovedOne: 'List removed',
    m3uRefreshed: 'List updated: {0} channels',
    suggestCountry: 'Free channels from Brazil (iptv-org)',
    suggestLanguage: 'Free channels in Portuguese (iptv-org)',
    suggestWorld: 'Free channels from the whole world (iptv-org, large)',
    suggestedLists: 'Suggested lists',
    phoneTitle: 'Send to the TV',
    phoneSend: 'Send to the TV',
    phoneSent: 'Sent. You can close this page.',
    phoneInvalid: 'Paste an address starting with http:// or https://',
    phoneScan: 'Or scan with your phone, on the same Wi-Fi, and paste the address there',
    phoneUnavailable: 'The TV could not open the page for the phone. Type the address here.',
    channelSearch: 'Search channel',
    channelRecent: 'Recent',
    channelNext: 'Next: {0}',
    noChannels: 'No channels here',
    m3uListInfo: '{0} channels · updated {1}',
    m3uRefreshAll: 'Update the lists now',
    removeListConfirm: 'Press OK again to remove this list',
    organizeCatalogs: 'Organize catalogs',
    rowsHint: 'OK on a name to move it with up and down. Right to show or hide it.',
    rowShown: 'Shown',
    rowHidden: 'Hidden',
    noRows: 'Install addons with catalogs to organize Home.',
    addonStore: 'Addon store',
    addAddon: 'Add by address',
    addonUrlHint: 'Type or paste the addon address (manifest.json)',
    addonInstalled: 'Addon installed',
    addonRemoved: 'Addon removed',
    addonNotChanged: 'Could not change the addons on your account',
    installAddon: 'Install',
    addonIsInstalled: 'Installed',
    removeAddon: 'Remove',
    removeAddonConfirm: 'Press OK again to remove',
    storeUnavailable: 'The store did not answer. Try again later.',
    addonsHint: 'Addons are saved on your account and show up on every device.',
    profilesHint: 'OK chooses · Down edits the profile',
    profileEditHint: 'OK on the name opens the keyboard · Back returns',
    hideNewEpisodes: 'Hide from New episodes',
    newEpisodesHidden: 'This series no longer appears in New episodes',
    showHiddenNewEpisodes: 'Bring back series removed from New episodes',
    newEpisodesShown: '{0} series back in New episodes',
    save: 'Save',
    cancel: 'Cancel',
    saving: 'Saving…',
    nuvioProfile: 'Nuvio profile',
    profilesUnavailable: 'Could not read the Nuvio profiles',
    becauseYouWatched: 'Because you watched {0}',
    syncSiteNote: 'Copy addons and library between Stremio and Nuvio: addons-sync.vercel.app',
    recommendedSource: 'Likely the best choice',
    pressOkRetry: 'Press OK to try again',
    noConnection:
      "Can't reach Stremio. Check the TV's internet connection. If other apps work, turn off IPv6 in the TV's network settings. ({0})",
    noConnectionShort: 'No connection to Stremio',
    evNoNetwork: 'Stremio could not be reached',
    lastSource: 'Last source',
    continuePlayback: 'Continue playback',
    sameSource: 'The same source used previously',
    seeders: 'seeders',
    seedsTag: '{0} seeds',
    compatibilityCheck: 'Check compatibility: {0}',
    sourcePrepareFailed: 'Could not prepare this source. Please try again.',
    runtimeRestoring: 'Restoring the local service…',
    runtimeUnavailable: 'Could not restore the local service',
    interfaceGroup: 'Interface',
    interfaceLanguage: 'Interface language',
    english: 'English',
    portugueseBrazil: 'Português (Brasil)',
    maintenanceGroup: 'Recovery',
    reloadApp: 'Reload StremCompat',
    diagnostics: 'Diagnostics',
    diagLoading: 'Reading…',
    diagUnavailable: 'The local service did not answer',
    diagServer: 'Local server: {0} MB in use (JS {1} MB) · running for {2} min',
    diagTv: 'Television: {0} MB free of {1} MB · CPU load {2}',
    diagDisk: 'Storage: {0} MB free of {1} MB',
    diagStreaming: 'Streaming server: {0}',
    diagStreamFailed: 'not available ({0})',
    torrentsUnavailable:
      'The torrent engine is not available on this TV. Debrid and direct sources still work.',
    diagEngineReady: 'Ready, starts with the first torrent',
    torrentsNoRoom: 'Not enough free space on the TV for torrents. Debrid and direct sources still work.',
    assStyle: 'ASS subtitle styling (position, italic, colour)',
    diagOnUsb: 'on the USB drive',
    diagCache: 'cache {0} of {1} MB',
    clearTorrentCache: 'Clear torrent cache',
    torrentsOnUsb: 'Always keep torrents on the USB drive',
    cacheCleared: '{0} MB of torrent cache cleared',
    cacheInUse: 'A torrent is playing. Try again when it stops.',
    testConnection: 'Test connection',
    testingConnection: 'Testing the connection…',
    connectionLatency: 'Stremio answers in {0} ms',
    connectionSpeed: 'last source {0} Mbit/s ({1})',
    connectionFailed: 'Stremio did not answer ({0})',
    diagRunning: 'running',
    diagStopped: 'stopped',
    diagInterface: 'Interface: {0} MB of JS · Home on screen in {1} s · catalogs in {2} s',
    diagPeak: 'Since start: local server peak {0} MB · lowest TV free memory {1} MB',
    diagRemote: 'Remote: {0} ms typical · {1} ms slowest · {2} % of frames late',
    diagRecent: 'Recent problems:',
    diagNoProblems: 'No problems recorded since start',
    evMediaError: 'Source would not play',
    evSlowStart: 'Source was slow to start, retried',
    evPrepareFailed: 'Source could not be prepared',
    evPlayRejected: 'Playback was refused',
    evAddonDown: 'Addon did not answer',
    reloadingApp: 'Reloading StremCompat…',
    supportGroup: 'Support',
    supportCoffee: 'Buy me a coffee',
    supportText:
      'StremCompat is free and made by one person. If it helps you, a coffee keeps it going. Scan the code with your phone:',
    preferredQuality: 'Preferred quality',
    qualityAsk: 'Ask',
    whichQuality: 'Which quality?',
    preferredLanguage: 'Audio language of sources',
    anyLanguage: 'Any',
    langFilter: 'Audio: {0}',
    subsFilter: 'Subtitles: {0}',
    langChipAll: 'Filter by language',
    langFilterTitle: 'Filter by language',
    langFilterSub: 'Audio: the source is dubbed in that language. Subtitles: only the subtitles come in it.',
    filterByAudio: 'By audio (dubbed)',
    filterBySubs: 'By embedded subtitles',
    clearLangFilter: 'Remove the filter (show all sources)',
    langAll: 'All',
    langOther: 'Other',
    subsTag: 'SUBS',
    automatic: 'Automatic',
    subtitlesGroup: 'Subtitles',
    subtitleSize: 'Subtitle size',
    defaultLanguage: 'Default language',
    backupLanguage: 'Backup language',
    subtitleColor: 'Subtitle color',
    subtitleOutline: 'Subtitle outline',
    subtitleBackground: 'Subtitle background',
    embeddedSubtitles: 'Embedded subtitles',
    audioGroup: 'Audio',
    autoAudio: 'Select audio automatically',
    defaultAudio: 'Default audio language',
    playbackGroup: 'Playback',
    seekInterval: 'Seek interval',
    nextEpisode: 'Play next episode',
    backgroundTrailers: 'Background trailers',
    scrubPreview: 'Seek preview',
    addonsGroup: 'Addons',
    addonsHelp: 'Addons synchronized with your Stremio account',
    syncAddons: 'Sync addons now',
    syncShort: 'Sync',
    noAddons: 'No addons are installed in this account.',
    accountGroup: 'Account',
    signOut: 'Sign out',
    disabled: 'Disabled',
    enabled: 'Enabled',
    white: 'White',
    yellow: 'Yellow',
    cyan: 'Cyan',
    black: 'Black',
    none: 'None',
    solid: 'Solid',
    transparent: 'Transparent',
    extractRecommended: 'Extract (recommended)',
    tvNative: 'TV native',
    french: 'French',
    spanish: 'Spanish',
    italian: 'Italian',
    german: 'German',
    arabic: 'Arabic',
    russian: 'Russian',
    turkish: 'Turkish',
    polish: 'Polish',
    dutch: 'Dutch',
    swedish: 'Swedish',
    hebrew: 'Hebrew',
    hindi: 'Hindi',
    japanese: 'Japanese',
    korean: 'Korean',
    chinese: 'Chinese',
    connectedAccount: 'Connected account',
    freeAccount: 'Free account',
    nuvioAccountLabel: 'Nuvio account',
    premiumUntil: 'Premium until {0}',
    settingsHint: 'Press OK to edit · Left returns to the menu',
    settingsEditing: 'Left/Right changes · OK confirms · Back cancels',
    syncing: 'Syncing…',
    addonsUpdated: 'Addons updated',
    addonsCurrent: 'Addons are already up to date',
    signingOut: 'Signing out…',
    phoneSignIn: 'Sign in with your phone',
    scanCode: 'Scan the code with your camera',
    generatingCode: 'Generating code',
    emailSignIn: 'Or use your email',
    email: 'Email',
    password: 'Password',
    keyboardSpace: 'Space',
    keyboardDone: 'Done',
    navCalendar: 'Calendar',
    calendarEmpty: 'No episodes of your series in the coming weeks',
    calendarToday: 'Today',
    calendarTomorrow: 'Tomorrow',
    navChannels: 'Channels',
    channelsEmpty: 'No channels yet: install an addon with TV channels, or add an M3U list in Settings',
    channelsAll: 'All',
    m3uGroup: 'Channels',
    m3uAdd: 'Add an M3U list',
    m3uRemove: 'Remove the M3U lists',
    m3uAddress: 'Address of the M3U list',
    m3uAdded: 'List added: {0} channels',
    m3uFailed: 'Could not read that list',
    m3uRemoved: 'M3U lists removed',
    liveNow: 'Now',
    updateInstallNow: 'Install version {0}',
    updateDownloading: 'Downloading the update…',
    updateFailed: 'The update could not be installed: {0}',
    updateCurrent: 'You have the latest version',
    signIn: 'Sign in',
    qrUnavailable: 'QR unavailable — use email',
    waitingPhone: 'Waiting for your phone',
    usePhoneCode: 'Use the access code on your phone',
    enterCredentials: 'Enter your email and password',
    signingIn: 'Signing in',
    signInFailed: 'Could not sign in',
    accountNote: 'No account? Create one for free at stremio.com/register or nuvio.tv',
    unofficialNote: 'Unofficial client. Not affiliated with Stremio, Nuvio or LG.',
    accountConnected: 'Account connected! Loading',
    genreAction: 'Action',
    genreComedy: 'Comedy',
    genreSciFi: 'Sci-Fi',
    genreDrama: 'Drama',
    genreHorror: 'Horror',
    player: {
      paused: 'Paused',
      nextEpisode: 'Next episode',
      playNext: 'Play next',
      playNextIn: 'Next episode in {0}',
      sourceFailed: 'This source could not be played',
      tryAnother: 'Try another source',
      failHint: 'OK: try another · Back: leave',
      countdownHint: 'OK: play now · Back: cancel',
      stillWatching: 'Are you still watching?',
      keepWatching: 'Continue watching',
      dismissHint: 'Up: select · Back: dismiss',
      liked: 'Liked this?',
      similar: 'Watch something similar',
      findSimilar: 'Find similar',
      playbackError: 'Playback error',
      retrying: 'Retrying this source…',
      resuming: 'Resuming from ',
      restartHint: 'OK: start over',
      fromStart: 'Playing from the start',
      nextLoading: 'Next episode…',
      moreLanguages: 'More languages',
      higher: 'Move up',
      lower: 'Move down',
      opacity: 'Opacity',
      episodes: 'Episodes',
      chapters: 'Chapters',
      files: 'Files in this torrent',
      picture: 'Picture',
      pictureFit: 'Whole picture',
      pictureZoom: 'Fill the screen',
      skipIntro: 'Skip intro',
      skipRecap: 'Skip recap',
      audioSubs: 'Audio and subtitles',
      sources: 'Sources',
      speed: 'Speed',
      speedRefused: 'This TV does not change the speed of this video',
      subtitlesReady: 'Subtitles ready',
      subtitleFailed: 'Subtitle extraction failed',
      nativeSubs: 'Native subtitles on',
      noNative: 'No native track — extracting…',
      preparingSubs: 'Preparing subtitles…',
      loadingSubtitle: 'Loading subtitles…',
      noHistoryOn: 'History is not being saved',
      noEmbedded: 'No embedded subtitles',
      defaultAudio: 'Default',
      off: 'Off',
      embedded: 'Embedded',
      external: 'External',
      selected: 'Selected',
      settings: 'Settings',
      audio: 'Audio',
      subtitles: 'Subtitles',
      none: 'None',
      readingTracks: 'Reading tracks…',
      noneInFile: 'None in this file',
      tracksStillLoading: 'The file is still loading. Try again in a few seconds.',
      tryAgain: 'Try again',
      style: 'Style',
      delay: 'Delay',
      later: 'Later (+0.1s)',
      earlier: 'Earlier (-0.1s)',
      reset: 'Reset',
      bigger: 'Text bigger',
      smaller: 'Text smaller',
      colour: 'Colour',
      background: 'Background',
      on: 'On',
      white: 'White',
      yellow: 'Yellow',
      couldNotResume: 'Could not resume playback',
      controlUnavailable: 'Playback control unavailable',
      inactive: 'Playback paused while the TV was inactive',
      restoring: 'Restoring the local service…',
      restoreFailed: 'Could not restore the local service',
      ready: 'Subtitles ready',
      loaded: 'Subtitles loaded',
      extracting: 'extracting',
      language: 'language'
    }
  },
  'pt-BR': {
    navSearch: 'Buscar',
    navHome: 'Início',
    navDiscover: 'Descobrir',
    navLibrary: 'Biblioteca',
    navAddons: 'Addons',
    navSettings: 'Ajustes',
    searchPlaceholder: 'Buscar filmes e séries',
    searchHint: 'Digite pelo teclado; os resultados aparecem enquanto você digita',
    searching: 'Buscando…',
    noResults: 'Nenhum resultado para “{0}”',
    movies: 'Filmes',
    series: 'Séries',
    anime: 'Anime',
    movie: 'Filme',
    seriesOne: 'Série',
    other: 'Outras',
    all: 'Todas',
    recent: 'Recente',
    recentSearches: 'Buscas recentes',
    seeAll: 'Ver tudo ›',
    seeAllHint: 'Abrir o catálogo completo em Descobrir',
    keySpace: 'espaço',
    keyDelete: 'apagar',
    keyClear: 'limpar',
    clearHistory: 'Limpar histórico',
    removeFromCw: 'Remover de Continuar assistindo',
    exitTitle: 'Sair do StremCompat?',
    exitSub: 'Escolha uma opção',
    exitStay: 'Continuar no app',
    exitLeave: 'Sair do app',
    removedFromCw: 'Removido de Continuar assistindo',
    torrentsNeedServer:
      'Esta TV não roda torrents sozinha. Defina um servidor em Configurações > Servidor de streaming.',
    serverAddress: 'Endereço',
    serverHere: 'Esta TV',
    serverTitle: 'Endereço do servidor de streaming',
    serverHint: 'Usado para torrents. Exemplo: 192.168.0.10:11470',
    serverDelete: 'Apagar',
    serverClear: 'Limpar',
    serverUseTv: 'Usar esta TV',
    serverSave: 'Testar e salvar',
    serverTesting: 'Testando a conexão…',
    serverSaved: 'Servidor de streaming salvo',
    serverLocal: 'Usando o servidor desta TV',
    serverInvalid: 'Confira o endereço',
    serverUnreachable: 'Nenhum servidor de streaming respondeu nesse endereço',
    serverDisk: 'Não foi possível salvar o endereço',
    historyGroup: 'Histórico',
    noHistory: 'Não salvar histórico',
    episodeAirDates: 'Datas de exibição nos episódios',
    clearSearches: 'Limpar buscas recentes',
    clearCw: 'Limpar Continuar assistindo',
    confirmAgain: 'Pressione OK de novo para confirmar',
    searchesCleared: 'Buscas recentes apagadas',
    cwCleared: 'Continuar assistindo limpo ({0})',
    nothingToClear: 'Nada para limpar',
    holdOkHint: 'Dica: segure OK em um título para mais opções',
    discoverTitle: 'Descobrir',
    popular: 'Populares',
    topRated: 'Mais bem avaliados',
    allGenres: 'Todos os gêneros',
    popularMovies: 'Populares · Filmes',
    popularSeries: 'Populares · Séries',
    topMovies: 'Mais bem avaliados · Filmes',
    topSeries: 'Mais bem avaliadas · Séries',
    trendingMovies: 'Em alta · Filmes',
    trendingSeries: 'Em alta · Séries',
    continueWatching: 'Continuar assistindo',
    myList: 'Minha lista',
    newEpisodes: 'Novos episódios',
    newEpisodeTag: 'Novo · T{0} E{1}',
    cwUpNext: 'Próximo · T{0} E{1}',
    cwEpisode: 'T{0} E{1}',
    cwLeft: 'faltam {0} min',
    badgeSoon: 'Em breve',
    badgeNew: 'Novo',
    emptyLibraryTitle: 'Sua biblioteca está vazia',
    emptyLibraryHint: 'Segure OK em qualquer título e escolha Adicionar à Biblioteca.',
    nothingFoundHint: 'Tente outro catálogo ou gênero.',
    similarEmptyHint: 'Este título ainda não tem sugestões parecidas.',
    noResultsHint: 'Tente outro nome, menos palavras ou o título original.',
    interfaceTextSize: 'Texto da interface',
    textNormal: 'Normal',
    textLarge: 'Maior',
    loadingTrailer: 'Carregando trailer…',
    trailerUnavailable: 'Trailer indisponível',
    trailerInYoutube: 'Abrindo o trailer no app do YouTube',
    noTrailer: 'Trailer indisponível',
    continueLabel: 'Continuar',
    continueEpisode: 'Continuar T{0} E{1}',
    playEpisode: 'Assistir T{0} E{1}',
    watch: 'Assistir',
    details: 'Detalhes',
    similarTitles: 'Ver títulos parecidos',
    trailer: 'Trailer',
    markWatched: 'Marcar como assistido',
    markedWatched: 'Marcado como assistido',
    markUnwatched: 'Marcar como não assistido',
    markedUnwatched: 'Marcado como não assistido',
    markSeasonWatched: 'Marcar temporada como assistida',
    markSeasonUnwatched: 'Marcar temporada como não assistida',
    removeLibrary: 'Remover da Biblioteca',
    addLibrary: 'Adicionar à Biblioteca',
    removedLibrary: 'Removido da Biblioteca',
    addedLibrary: 'Adicionado à Biblioteca',
    inLibrary: 'Na Biblioteca',
    libraryButton: 'Biblioteca',
    similar: 'Parecidos',
    similarTo: 'Parecidos com {0}',
    findingSimilar: 'Buscando títulos parecidos…',
    nothingFound: 'Nada encontrado.',
    couldNotLoad: 'Não foi possível carregar o título',
    specials: 'Especiais',
    season: 'Temporada {0}',
    episode: 'Episódio {0}',
    seasonEpisode: 'Temporada {0} · Episódio {1}',
    absoluteEpisode: 'Episódio geral {0}',
    seasonAbsoluteEpisode: 'Temporada {0} · Episódio {1} · Episódio geral {2}',
    seasonOrder: 'Por temporada',
    continuousOrder: 'Ordem contínua',
    previous: 'Anterior',
    next: 'Próximo',
    episodeRange: 'Episódios {0}–{1}',
    goToEpisode: 'Ir para episódio',
    episodeNumberPrompt: 'Digite o número geral do episódio',
    episodeNotFound: 'Episódio não encontrado',
    jumpDelete: 'Apagar',
    jumpGo: 'Ir',
    jumpHint: 'Use as setas e OK. Voltar cancela.',
    sources: 'Fontes',
    findingSources: 'Buscando fontes…',
    noSources: 'Nenhuma fonte encontrada.',
    noSourcesQuality: 'Nenhuma fonte nesta qualidade.',
    addonsNoAnswer: 'Sem resposta de: {0}',
    tryingNextSource: 'Tentando a próxima fonte…',
    noOtherSource: 'Não há outra fonte para tentar',
    catalogsFailed: 'Nenhum catálogo pôde ser carregado. Verifique a conexão e seus addons.',
    playBest: 'Melhor fonte',
    directedBy: 'Direção: {0}',
    sourceLanguageRow: 'Áudio: {0}',
    bestAudioHint: 'Fontes com áudio em {0} primeiro. A legenda você escolhe depois, no player.',
    bestAudioAny: 'Qualquer idioma de áudio. A legenda você escolhe depois, no player.',
    audioLanguageTitle: 'Idioma do áudio',
    audioLanguageSub: 'Fontes dubladas nesse idioma vêm primeiro. A legenda você escolhe depois, no player.',
    anyAudioLanguage: 'Qualquer idioma',
    sourcesButton: 'Todas as fontes',
    seeDetails: 'Ver detalhes',
    playingBest: 'Tocando a melhor fonte: {0}',
    updateAvailable: 'StremCompat {0} disponível. Atualize pelo Homebrew Channel.',
    updateNav: 'Atualizar',
    updateTitle: 'O StremCompat {0} está disponível',
    updateSub: 'Ele é instalado por cima desta versão e mantém sua conta e seus ajustes.',
    updateNow: 'Atualizar agora',
    updateLater: 'Depois',
    updateStarting: 'Baixando a atualização…',
    updateProgress: 'Baixando a atualização… {0}%',
    updateInstalling: 'Instalando a atualização. O StremCompat vai fechar e abrir de novo.',
    updateElsewhere: 'Não foi possível atualizar por aqui. Atualize o StremCompat no Homebrew Channel.',
    whatsNew: 'Atualizado para o StremCompat {0}.',
    lastStartStopped:
      'Da última vez, o StremCompat parou enquanto abria (etapa {0}). Se acontecer de novo, cite essa etapa no seu relato.',
    setupUseQuestion: 'Como você quer usar o StremCompat?',
    modeSimple: 'Simples',
    modeSimpleHint: 'Só o essencial nas configurações e no player. A melhor fonte em um botão.',
    modeFull: 'Completo',
    modeFullHint: 'Todas as opções, como até agora.',
    setupLookQuestion: 'Qual visual?',
    lookLight: 'Leve',
    lookLightHint: 'Sem efeitos e com imagens menores. Melhor para webOS 3 e TVs com pouca memória.',
    setupSkip: 'Pular',
    setupHint: 'Dá para mudar depois em Configurações.',
    uiModeLabel: 'Modo de uso',
    uiLookLabel: 'Visual',
    lookStandard: 'Padrão',
    lookStandardHint: 'Recomendado para a maioria das TVs. O visual das versões anteriores.',
    providerNuvio: 'Nuvio',
    whoIsWatching: 'Quem está assistindo?',
    profileNumber: 'Perfil {0}',
    profileLocked: 'Protegido por PIN',
    addProfile: 'Adicionar perfil',
    editProfile: 'Editar perfil',
    profileName: 'Nome',
    profileNameNeeded: 'Dê um nome ao perfil',
    profileNotSaved: 'Não foi possível salvar o perfil no Nuvio',
    pinEnter: 'Digite o PIN de {0}',
    pinWrong: 'PIN errado',
    pinWait: 'Muitas tentativas. Tente de novo em {0} s',
    pinNew: 'Escolha um PIN de 4 números',
    pinCurrent: 'Digite o PIN atual',
    pinSet: 'Definir PIN',
    pinRemove: 'Remover PIN',
    pinSaved: 'PIN salvo',
    pinRemoved: 'PIN removido',
    pinNotSaved: 'Não foi possível mudar o PIN no Nuvio',
    pinDelete: 'Apagar',
    watchAgain: 'Assistir de novo',
    retry: 'Tentar de novo',
    nothingHere: 'Nada aqui ainda',
    moreText: 'Mais',
    titleUnavailable: 'Não foi possível abrir este título',
    watchedShort: 'Assistido',
    episodesTitle: 'Episódios',
    searchInSources: 'Buscar nas fontes',
    copyLink: 'Copiar link',
    linkCopied: 'Link copiado',
    openInOtherApp: 'Abrir em outro app',
    loadingText: 'Carregando…',
    sortBy: 'Ordenar',
    sortRecent: 'Adicionados recentemente',
    sortAZ: 'Nome (A–Z)',
    upcomingShort: 'Em breve',
    emptyLibraryPhone: 'Toque e segure em um título e escolha Adicionar à Biblioteca.',
    phoneLoginHint: 'Entre para ver sua biblioteca e seus addons.',
    continueInBrowser: 'Continuar no navegador',
    browserApproveHint: 'Aprove na página que abrir e volte aqui',
    phoneGroup: 'Celular',
    accentColor: 'Cor de destaque',
    accent_violet: 'Violeta',
    accent_crimson: 'Carmesim',
    accent_ocean: 'Oceano',
    accent_emerald: 'Esmeralda',
    accent_amber: 'Âmbar',
    accent_rose: 'Rosa',
    accent_white: 'Branco',
    playBestAutomatically: 'Tocar a melhor fonte automaticamente',
    playerChoice: 'Player',
    playerBuiltIn: 'Do app',
    playerExternal: 'Outro app (VLC, MX Player…)',
    phoneSearchTitle: 'Buscar na TV',
    phoneSearchHint: 'Escaneie para digitar a busca no celular',
    screensaverSetting: 'Proteção de tela',
    minutesN: '{0} minutos',
    filterCached: 'Em cache',
    filterHdr: 'HDR',
    filterAtmos: 'Atmos',
    filterRemux: 'Remux',
    filterNoCam: 'Sem CAM',
    markSeriesWatched: 'Marcar série como assistida',
    markSeriesUnwatched: 'Marcar série como não assistida',
    spoilersSetting: 'Spoilers',
    spoilersShow: 'Mostrar tudo',
    spoilersPictures: 'Desfocar imagens não vistas',
    spoilersAll: 'Ocultar imagens e sinopses',
    spoilerHidden: 'Sinopse oculta até você assistir a este episódio.',
    upcomingRow: 'Próximos episódios',
    upcomingTag: 'T{0} E{1} · {2}',
    forcedSubsSetting: 'Só legendas forçadas',
    skipIntroSetting: 'Pular abertura e recapitulação',
    skipOnOk: 'Com OK',
    skipByItself: 'Sozinho',
    endsAt: 'Termina às {0}',
    nextCardHint: 'OK para assistir agora · Voltar para continuar aqui',
    cachedTag: 'Em cache',
    audioNotPlayable: 'Esta TV não toca este áudio. Tente outra faixa de áudio ou outra fonte.',
    addonsLeft: 'Ainda respondendo: {0}',
    notOnThisTv: 'Não tocou nesta TV: {0}',
    folderAddonMissing: 'Instale o addon {0} no Nuvio para ver esta lista.',
    folderLists: '{0} listas',
    folderExplore: 'OK para explorar',
    discoverMaxLabel: 'Títulos no Descobrir',
    discoverMax80: '80 (TVs mais fracas)',
    discoverMax200: '200 (padrão)',
    discoverMax500: '500 (TVs com mais memória)',
    pointerLabel: 'Ponteiro do Magic Remote',
    folderAll: 'Todos',
    folderSourceUnavailable: 'Esta fonte vem do TMDB ou do Trakt, que só o app do Nuvio consegue abrir.',
    store_all: 'Todos',
    store_streams: 'Filmes e séries',
    store_channels: 'Canais',
    store_subtitles: 'Legendas',
    store_catalogs: 'Catálogos',
    storeConfigure: 'Configurar no celular',
    storeConfigureHint: 'Este addon precisa ser configurado antes. Escaneie o código, configure no celular e depois adicione aqui em "Adicionar por endereço" (o celular também pode enviar o endereço).',
    m3uManage: 'Gerenciar listas',
    noLists: 'Nenhuma lista M3U adicionada ainda',
    liveLabel: 'AO VIVO',
    m3uRemovedOne: 'Lista removida',
    m3uRefreshed: 'Lista atualizada: {0} canais',
    suggestCountry: 'Canais abertos do Brasil (iptv-org)',
    suggestLanguage: 'Canais abertos em português (iptv-org)',
    suggestWorld: 'Canais abertos do mundo todo (iptv-org, grande)',
    suggestedLists: 'Listas sugeridas',
    phoneTitle: 'Enviar para a TV',
    phoneSend: 'Enviar para a TV',
    phoneSent: 'Enviado. Pode fechar esta página.',
    phoneInvalid: 'Cole um endereço que comece com http:// ou https://',
    phoneScan: 'Ou escaneie com o celular, no mesmo Wi-Fi, e cole o endereço por lá',
    phoneUnavailable: 'A TV não conseguiu abrir a página para o celular. Digite o endereço aqui.',
    channelSearch: 'Buscar canal',
    channelRecent: 'Recentes',
    channelNext: 'A seguir: {0}',
    noChannels: 'Nenhum canal aqui',
    m3uListInfo: '{0} canais · atualizada {1}',
    m3uRefreshAll: 'Atualizar as listas agora',
    removeListConfirm: 'Aperte OK de novo para remover esta lista',
    organizeCatalogs: 'Organizar catálogos',
    rowsHint: 'OK no nome para mover com cima e baixo. Direita para mostrar ou ocultar.',
    rowShown: 'Visível',
    rowHidden: 'Oculto',
    noRows: 'Instale addons com catálogos para organizar a Home.',
    addonStore: 'Loja de addons',
    addAddon: 'Adicionar por endereço',
    addonUrlHint: 'Digite ou cole o endereço do addon (manifest.json)',
    addonInstalled: 'Addon instalado',
    addonRemoved: 'Addon removido',
    addonNotChanged: 'Não foi possível mudar os addons da sua conta',
    installAddon: 'Instalar',
    addonIsInstalled: 'Instalado',
    removeAddon: 'Remover',
    removeAddonConfirm: 'Aperte OK de novo para remover',
    storeUnavailable: 'A loja não respondeu. Tente mais tarde.',
    addonsHint: 'Os addons ficam salvos na sua conta e aparecem em todos os aparelhos.',
    profilesHint: 'OK escolhe · Para baixo edita o perfil',
    profileEditHint: 'OK no nome abre o teclado · Voltar retorna',
    hideNewEpisodes: 'Não mostrar em Novos episódios',
    newEpisodesHidden: 'Esta série não aparece mais em Novos episódios',
    showHiddenNewEpisodes: 'Trazer de volta séries tiradas de Novos episódios',
    newEpisodesShown: '{0} série(s) de volta em Novos episódios',
    save: 'Salvar',
    cancel: 'Cancelar',
    saving: 'Salvando…',
    nuvioProfile: 'Perfil do Nuvio',
    profilesUnavailable: 'Não foi possível ler os perfis do Nuvio',
    becauseYouWatched: 'Porque você assistiu {0}',
    syncSiteNote: 'Copie addons e biblioteca entre Stremio e Nuvio: addons-sync.vercel.app',
    recommendedSource: 'Provável melhor opção',
    pressOkRetry: 'Pressione OK para tentar de novo',
    noConnection:
      'Não foi possível conectar ao Stremio. Verifique a internet da TV. Se outros apps funcionam, desative o IPv6 nas configurações de rede da TV. ({0})',
    noConnectionShort: 'Sem conexão com o Stremio',
    evNoNetwork: 'O Stremio não pôde ser alcançado',
    lastSource: 'Última fonte',
    continuePlayback: 'Continuar reprodução',
    sameSource: 'A mesma fonte usada anteriormente',
    seeders: 'seeders',
    seedsTag: '{0} seeds',
    compatibilityCheck: 'Verifique a compatibilidade: {0}',
    sourcePrepareFailed: 'Não foi possível preparar esta fonte. Tente novamente.',
    runtimeRestoring: 'Restaurando o serviço local…',
    runtimeUnavailable: 'Não foi possível restaurar o serviço local',
    interfaceGroup: 'Interface',
    interfaceLanguage: 'Idioma da interface',
    english: 'English',
    portugueseBrazil: 'Português (Brasil)',
    maintenanceGroup: 'Recuperação',
    reloadApp: 'Recarregar StremCompat',
    diagnostics: 'Diagnóstico',
    diagLoading: 'Lendo…',
    diagUnavailable: 'O serviço local não respondeu',
    diagServer: 'Servidor local: {0} MB em uso (JS {1} MB) · ativo há {2} min',
    diagTv: 'TV: {0} MB livres de {1} MB · carga da CPU {2}',
    diagDisk: 'Armazenamento: {0} MB livres de {1} MB',
    diagStreaming: 'Servidor de streaming: {0}',
    diagStreamFailed: 'indisponível ({0})',
    torrentsUnavailable:
      'O motor de torrents não está disponível nesta TV. Fontes debrid e diretas continuam funcionando.',
    diagEngineReady: 'Pronto, inicia com o primeiro torrent',
    torrentsNoRoom:
      'Não há espaço livre suficiente na TV para torrents. Fontes debrid e diretas continuam funcionando.',
    assStyle: 'Estilo das legendas ASS (posição, itálico, cor)',
    diagOnUsb: 'no pendrive',
    diagCache: 'cache {0} de {1} MB',
    clearTorrentCache: 'Limpar cache de torrents',
    torrentsOnUsb: 'Guardar torrents sempre no pen drive',
    cacheCleared: '{0} MB de cache de torrents apagados',
    cacheInUse: 'Um torrent está tocando. Tente de novo quando ele parar.',
    testConnection: 'Testar conexão',
    testingConnection: 'Testando a conexão…',
    connectionLatency: 'O Stremio responde em {0} ms',
    connectionSpeed: 'última fonte {0} Mbit/s ({1})',
    connectionFailed: 'O Stremio não respondeu ({0})',
    diagRunning: 'ativo',
    diagStopped: 'parado',
    diagInterface: 'Interface: {0} MB de JS · Início na tela em {1} s · catálogos em {2} s',
    diagPeak: 'Desde o início: pico do servidor local {0} MB · menor memória livre da TV {1} MB',
    diagRemote: 'Controle: {0} ms normalmente · {1} ms no pior caso · {2} % dos quadros atrasados',
    diagRecent: 'Problemas recentes:',
    diagNoProblems: 'Nenhum problema registrado desde o início',
    evMediaError: 'A fonte não reproduziu',
    evSlowStart: 'A fonte demorou a iniciar, tentou de novo',
    evPrepareFailed: 'A fonte não pôde ser preparada',
    evPlayRejected: 'A reprodução foi recusada',
    evAddonDown: 'O addon não respondeu',
    reloadingApp: 'Recarregando o StremCompat…',
    supportGroup: 'Apoiar',
    supportCoffee: 'Pague um café ao desenvolvedor',
    supportText:
      'O StremCompat é gratuito e feito por uma pessoa só. Se ele te ajuda, um café ajuda a continuar. Aponte a câmera do celular para o código:',
    preferredQuality: 'Qualidade preferida',
    qualityAsk: 'Perguntar',
    whichQuality: 'Qual qualidade?',
    preferredLanguage: 'Idioma do áudio das fontes',
    anyLanguage: 'Qualquer',
    langFilter: 'Áudio: {0}',
    subsFilter: 'Legenda: {0}',
    langChipAll: 'Filtrar idioma',
    langFilterTitle: 'Filtrar por idioma',
    langFilterSub: 'Áudio: a fonte é dublada nesse idioma. Legenda: só a legenda vem nesse idioma.',
    filterByAudio: 'Por áudio (dublagem)',
    filterBySubs: 'Por legenda embutida',
    clearLangFilter: 'Tirar o filtro (mostrar todas as fontes)',
    langAll: 'Todos',
    langOther: 'Outros',
    subsTag: 'LEG',
    automatic: 'Automática',
    subtitlesGroup: 'Legendas',
    subtitleSize: 'Tamanho da legenda',
    defaultLanguage: 'Idioma padrão',
    backupLanguage: 'Idioma de reserva',
    subtitleColor: 'Cor da legenda',
    subtitleOutline: 'Contorno da legenda',
    subtitleBackground: 'Fundo da legenda',
    embeddedSubtitles: 'Legendas incorporadas',
    audioGroup: 'Áudio',
    autoAudio: 'Selecionar áudio automaticamente',
    defaultAudio: 'Idioma de áudio padrão',
    playbackGroup: 'Reprodução',
    seekInterval: 'Intervalo de avanço',
    nextEpisode: 'Reproduzir próximo episódio',
    backgroundTrailers: 'Trailers em segundo plano',
    scrubPreview: 'Prévia ao avançar',
    addonsGroup: 'Addons',
    addonsHelp: 'Addons sincronizados com sua conta Stremio',
    syncAddons: 'Sincronizar addons agora',
    syncShort: 'Sincronizar',
    noAddons: 'Nenhum addon instalado nesta conta.',
    accountGroup: 'Conta',
    signOut: 'Sair',
    disabled: 'Desativado',
    enabled: 'Ativado',
    white: 'Branco',
    yellow: 'Amarelo',
    cyan: 'Ciano',
    black: 'Preto',
    none: 'Nenhum',
    solid: 'Sólido',
    transparent: 'Transparente',
    extractRecommended: 'Extrair (recomendado)',
    tvNative: 'Nativo da TV',
    french: 'Francês',
    spanish: 'Espanhol',
    italian: 'Italiano',
    german: 'Alemão',
    arabic: 'Árabe',
    russian: 'Russo',
    turkish: 'Turco',
    polish: 'Polonês',
    dutch: 'Holandês',
    swedish: 'Sueco',
    hebrew: 'Hebraico',
    hindi: 'Hindi',
    japanese: 'Japonês',
    korean: 'Coreano',
    chinese: 'Chinês',
    connectedAccount: 'Conta conectada',
    freeAccount: 'Conta gratuita',
    nuvioAccountLabel: 'Conta Nuvio',
    premiumUntil: 'Premium até {0}',
    settingsHint: 'Pressione OK para editar · esquerda volta ao menu',
    settingsEditing: 'Esquerda/direita altera · OK confirma · Voltar cancela',
    syncing: 'Sincronizando…',
    addonsUpdated: 'Addons atualizados',
    addonsCurrent: 'Addons já estão atualizados',
    signingOut: 'Saindo…',
    phoneSignIn: 'Entrar pelo celular',
    scanCode: 'Escaneie o código com a câmera',
    generatingCode: 'Gerando código',
    emailSignIn: 'Ou use seu e-mail',
    email: 'Email',
    password: 'Senha',
    keyboardSpace: 'Espaço',
    keyboardDone: 'Concluir',
    navCalendar: 'Calendário',
    calendarEmpty: 'Nenhum episódio das suas séries nas próximas semanas',
    calendarToday: 'Hoje',
    calendarTomorrow: 'Amanhã',
    navChannels: 'Canais',
    channelsEmpty:
      'Nenhum canal ainda: instale um addon com canais de TV ou adicione uma lista M3U em Ajustes',
    channelsAll: 'Todos',
    m3uGroup: 'Canais',
    m3uAdd: 'Adicionar lista M3U',
    m3uRemove: 'Remover as listas M3U',
    m3uAddress: 'Endereço da lista M3U',
    m3uAdded: 'Lista adicionada: {0} canais',
    m3uFailed: 'Não foi possível ler essa lista',
    m3uRemoved: 'Listas M3U removidas',
    liveNow: 'Agora',
    updateInstallNow: 'Instalar a versão {0}',
    updateDownloading: 'Baixando a atualização…',
    updateFailed: 'Não foi possível instalar a atualização: {0}',
    updateCurrent: 'Você está na versão mais recente',
    signIn: 'Entrar',
    qrUnavailable: 'QR indisponível — use o e-mail',
    waitingPhone: 'Aguardando seu celular',
    usePhoneCode: 'Use o código de acesso pelo celular',
    enterCredentials: 'Digite e-mail e senha',
    signingIn: 'Entrando',
    signInFailed: 'Não foi possível entrar',
    accountNote: 'Não tem conta? Crie grátis em stremio.com/register ou nuvio.tv',
    unofficialNote: 'Cliente não oficial. Sem vínculo com o Stremio, o Nuvio ou a LG.',
    accountConnected: 'Conta conectada! Carregando',
    genreAction: 'Ação',
    genreComedy: 'Comédia',
    genreSciFi: 'Ficção científica',
    genreDrama: 'Drama',
    genreHorror: 'Terror',
    player: {
      paused: 'Pausado',
      nextEpisode: 'Próximo episódio',
      playNext: 'Reproduzir próximo',
      playNextIn: 'Próximo episódio em {0}',
      sourceFailed: 'Não foi possível reproduzir esta fonte',
      tryAnother: 'Tentar outra fonte',
      failHint: 'OK: tentar outra · Voltar: sair',
      countdownHint: 'OK: assistir agora · Voltar: cancelar',
      stillWatching: 'Você ainda está assistindo?',
      keepWatching: 'Continuar assistindo',
      dismissHint: 'Cima: selecionar · Voltar: fechar',
      liked: 'Gostou?',
      similar: 'Ver algo parecido',
      findSimilar: 'Encontrar parecidos',
      playbackError: 'Erro de reprodução',
      retrying: 'Tentando iniciar a fonte novamente…',
      resuming: 'Continuando de ',
      restartHint: 'OK: recomeçar',
      fromStart: 'Reproduzindo do início',
      nextLoading: 'Próximo episódio…',
      moreLanguages: 'Mais idiomas',
      higher: 'Mais para cima',
      lower: 'Mais para baixo',
      opacity: 'Opacidade',
      episodes: 'Episódios',
      chapters: 'Capítulos',
      files: 'Arquivos deste torrent',
      picture: 'Imagem',
      pictureFit: 'Imagem inteira',
      pictureZoom: 'Preencher a tela',
      skipIntro: 'Pular abertura',
      skipRecap: 'Pular recapitulação',
      audioSubs: 'Áudio e legendas',
      sources: 'Fontes',
      speed: 'Velocidade',
      speedRefused: 'Esta TV não muda a velocidade deste vídeo',
      subtitlesReady: 'Legendas prontas',
      subtitleFailed: 'Falha ao extrair legendas',
      nativeSubs: 'Legendas nativas ativadas',
      noNative: 'Faixa nativa indisponível — extraindo…',
      preparingSubs: 'Preparando legendas…',
      loadingSubtitle: 'Carregando legenda…',
      noHistoryOn: 'O histórico não está sendo salvo',
      noEmbedded: 'Nenhuma legenda incorporada',
      defaultAudio: 'Padrão',
      off: 'Desativadas',
      embedded: 'Incorporadas',
      external: 'Externas',
      selected: 'Selecionada',
      settings: 'Ajustes',
      audio: 'Áudio',
      subtitles: 'Legendas',
      none: 'Nenhuma',
      readingTracks: 'Lendo faixas…',
      noneInFile: 'Nenhuma neste arquivo',
      tracksStillLoading: 'O arquivo ainda está carregando. Tente de novo em alguns segundos.',
      tryAgain: 'Tentar de novo',
      style: 'Estilo',
      delay: 'Atraso',
      later: 'Mais tarde (+0,1s)',
      earlier: 'Mais cedo (-0,1s)',
      reset: 'Redefinir',
      bigger: 'Aumentar texto',
      smaller: 'Diminuir texto',
      colour: 'Cor',
      background: 'Fundo',
      on: 'Ativado',
      white: 'Branco',
      yellow: 'Amarelo',
      couldNotResume: 'Não foi possível continuar',
      controlUnavailable: 'Controle de reprodução indisponível',
      inactive: 'Reprodução pausada enquanto a TV estava inativa',
      restoring: 'Restaurando o serviço local…',
      restoreFailed: 'Não foi possível restaurar o serviço local',
      ready: 'Prontas',
      loaded: 'Legendas carregadas',
      extracting: 'extraindo',
      language: 'idioma'
    }
  }
};
/* in the language itself, whichever one the interface is in */
var UI_LANGUAGES = {
  'en-US': 'English',
  'pt-BR': 'Português (Brasil)',
  es: 'Español (España)',
  'es-419': 'Español (Latinoamérica)',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ru: 'Русский',
  ko: '한국어',
  ja: '日本語',
  zh: '中文（简体）'
};
function normalizeUILanguage(value) {
  return Object.prototype.hasOwnProperty.call(UI_LANGUAGES, value) ? value : 'en-US';
}
/* the TV's language, when the app has it */
function tvLanguage() {
  var full = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase(),
    base = full.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  /* Spanish outside Spain is the Latin American one */
  if (base === 'es') return full === 'es' || full === 'es-es' ? 'es' : 'es-419';
  return base;
}
/* what the file does not have, or a file that cannot be read, falls back to English */
function loadUILanguage(code) {
  if (UI_TEXT[code]) return;
  try {
    var request = new XMLHttpRequest();
    request.open('GET', '/lang/' + code + '.json', false);
    request.send();
    if (request.status === 200) UI_TEXT[code] = JSON.parse(request.responseText);
  } catch (e) {}
}
var UI_LANG = normalizeUILanguage(
  (function () {
    try {
      return localStorage.getItem(UI_LANG_KEY) || tvLanguage();
    } catch (e) {
      return tvLanguage();
    }
  })()
);
loadUILanguage(UI_LANG);
/* the language of audio and subtitles until the viewer picks one */
function defaultMediaLanguage() {
  return (
    {
      'pt-BR': 'por',
      es: 'spa',
      'es-419': 'spa',
      fr: 'fre',
      de: 'ger',
      it: 'ita',
      ru: 'rus',
      ko: 'kor',
      ja: 'jpn',
      zh: 'chi'
    }[UI_LANG] || 'eng'
  );
}
function tx(key) {
  var args = arguments,
    text = (UI_TEXT[UI_LANG] && UI_TEXT[UI_LANG][key]) || UI_TEXT['en-US'][key] || key;
  return String(text).replace(/\{(\d+)\}/g, function (all, index) {
    var at = parseInt(index, 10) + 1;
    return args[at] == null ? '' : String(args[at]);
  });
}
// When a title counts as finished, shared by the interface and the player.
/* As the official Stremio apps (stremio-core): finished once the position passes 90 %,
   where credits usually start. Continue Watching, the resume offer and the next episode
   all use this rule; the player marks a video watched at 70 % really played. */
var CREDITS_THRESHOLD = 0.9;
function watchFinished(offsetMs, durationMs) {
  return durationMs > 0 && offsetMs > durationMs * CREDITS_THRESHOLD;
}
// Which installed addons answer stream requests; shared by the interface and the player.
function addonBase(a) {
  return String(a.transportUrl || '').replace(/\/manifest\.json.*$/, '');
}
/* Whatever follows /manifest.json in the installed link (a ?key=... some addons give each
   user). Official Stremio replaces only /manifest.json when it builds a request, so the
   query string reaches every catalog, meta and stream request (stremio-core
   http_transport.rs); dropping it made such addons answer nothing here. */
function addonQuery(a) {
  var m = String((a && a.transportUrl) || '').match(/\/manifest\.json(\?[^#]*)/);
  return m ? m[1] : '';
}
/* The installed addons that answer `resource` ('stream', 'subtitles') for `type`, as Stremio
   picks them: the resource may be a name (manifest types apply) or an object with its own
   types and idPrefixes. With an `id`, idPrefixes are checked too (a subtitle addon for IMDb
   ids is not asked about a Kitsu episode). */
function addonsFor(a, resource, type, id) {
  var out = [];
  a = a || [];
  for (var i = 0; i < a.length; i++) {
    var m = a[i] && a[i].manifest;
    if (!m) continue;
    var res = m.resources || [],
      entry = null;
    for (var r = 0; r < res.length; r++) {
      var rr = res[r];
      if (rr === resource || (rr && rr.name === resource)) entry = rr;
    }
    if (!entry) continue;
    var types = m.types || [],
      own = typeof entry === 'object' ? entry.types || [] : null;
    /* the manifest types, or the resource object's own types; an object with no types
       means "any type" */
    if (types.length && types.indexOf(type) < 0 && !(own && (!own.length || own.indexOf(type) >= 0)))
      continue;
    var prefixes = (typeof entry === 'object' && entry.idPrefixes) || m.idPrefixes;
    if (id && prefixes && prefixes.length) {
      var okId = false;
      for (var p = 0; p < prefixes.length; p++) if (String(id).indexOf(prefixes[p]) === 0) okId = true;
      if (!okId) continue;
    }
    out.push({ name: m.name || 'Addon', base: addonBase(a[i]), query: addonQuery(a[i]) });
  }
  return out;
}
function streamAddonsIn(a, type) {
  return addonsFor(a, 'stream', type);
}
/* <base>/<resource>/<type>/<id>[/<extra>].json<query>, extra as Stremio encodes it:
   videoHash=..&videoSize=..&filename=.. */
function addonResourceUrl(ad, resource, type, id, extra) {
  var parts = [];
  for (var k in extra || {})
    if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== '' && extra[k] != null)
      parts.push(k + '=' + encodeURIComponent(extra[k]));
  return (
    ad.base +
    '/' +
    resource +
    '/' +
    type +
    '/' +
    encodeURIComponent(id) +
    (parts.length ? '/' + parts.join('&') : '') +
    '.json' +
    (ad.query || '')
  );
}
function streamUrl(ad, type, vid) {
  return addonResourceUrl(ad, 'stream', type, vid);
}
// Reading a source from an addon's answer and matching it across episodes; shared by the
// interface (source list) and the player (next episode).
function streamText(s) {
  return String(
    (s.name || '') +
      ' ' +
      (s.title || '') +
      ' ' +
      (s.description || '') +
      ' ' +
      ((s.behaviorHints && s.behaviorHints.filename) || '')
  );
}
function streamQuality(s) {
  var t = streamText(s).toLowerCase();
  if (/\b(2160p?|4k|uhd)\b/.test(t)) return '4K';
  if (/\b(1440p?|2k|qhd)\b/.test(t)) return '1440p';
  if (/\b(1080p?|fhd)\b/.test(t)) return '1080p';
  if (/\b720p?\b/.test(t)) return '720p';
  if (/\b(576p?|540p?|480p?|360p?|sd)\b/.test(t)) return 'SD';
  return 'Other';
}
function streamSeeders(s) {
  var t = streamText(s),
    m;
  m = t.match(/(?:seeders?|seeds?)\s*[:\-]?\s*(\d+)/i);
  if (m) return parseInt(m[1], 10) || 0;
  m = t.match(/(\d+)\s*(?:seeders?|seeds?)/i);
  if (m) return parseInt(m[1], 10) || 0;
  m = t.match(/(?:\uD83D\uDC65|\uD83D\uDC64)\s*(\d+)/);
  if (m) return parseInt(m[1], 10) || 0;
  return -1;
}
/* Filename/title hints are advisory: addons do not expose a reliable codec schema.
   Only AV1 and Dolby Vision without an advertised HDR fallback affect ordering;
   audio and 10-bit hints remain visible without hiding a potentially playable source. */
function streamCompatibility(s) {
  var t = streamText(s).toLowerCase(),
    labels = [],
    rank = 0;
  function add(label) {
    for (var i = 0; i < labels.length; i++) if (labels[i] === label) return;
    labels.push(label);
  }
  if (/\b(av1|av01)\b/.test(t)) {
    add('AV1');
    rank = 3;
  }
  var dv = /(dolby[ ._-]?vision|\bdovi\b|\bdv\b)/.test(t);
  if (dv) {
    add('Dolby Vision');
    if (!/(hdr10\+?|\bhdr\b)/.test(t)) rank = Math.max(rank, 2);
  }
  if (/\b(hevc|h[ ._-]?265|x265)\b/.test(t) && /\b(10[ ._-]?bit|main[ ._-]?10)\b/.test(t)) add('HEVC 10-bit');
  /* 10-bit H.264 (Hi10P, common in anime releases): many TVs have no hardware decoder for it, some
     do, and VLC on a phone plays it. A warning that moves it a little down, as Dolby Vision
     without HDR, never with the formats that cannot play. */
  if (/\bhi10p?\b/.test(t) || (/\b(h[ ._-]?264|x264|avc)\b/.test(t) && /\b10[ ._-]?bit\b/.test(t))) {
    add('H.264 10-bit');
    rank = Math.max(rank, 2);
  }
  if (/\b(true[ ._-]?hd)\b/.test(t)) add('TrueHD');
  else if (/\b(dts[ ._-]?hd|dts)\b/.test(t)) add('DTS');
  if (/\b(e[ ._-]?ac[ ._-]?3|eac3|ddp|dd\+)\b/.test(t)) add('E-AC-3');
  /* A link or torrent file that is a .rar/.zip/.7z archive cannot play: the TV would have to
     unpack it. Only a real file extension counts ("RARBG" is a release group), and such a
     source is moved to the end and never recommended rather than hidden. */
  var file = (
      String(s.filename || '') +
      ' ' +
      String(s.url || '').replace(/[?#].*$/, '') +
      ' ' +
      t
    ).toLowerCase(),
    archive = file.match(/\.(rar|zip|7z)(?![a-z0-9])/);
  if (archive) {
    add(archive[1].toUpperCase());
    rank = Math.max(rank, 4);
  } else if (/\brar\b/.test(t)) {
    /* debrid services that keep a torrent packed say only "RAR" (RARBG is a word of its own) */
    add('RAR');
    rank = Math.max(rank, 4);
  }
  return { labels: labels, rank: rank };
}
/* ---- the audio and subtitle languages of a source, read once when the addon answers ----
   Only the name says it, so the clues are weighed:
   - words that name the audio ("Dublado", "Latino", "Castellano", "VFF", "iTA", "ENG") and words
     that name subtitles ("Legendado", "VOSTFR", "Sub ITA ENG", "Eng Subs", "MultiSub");
   - the flags Torrentio lists, which mix audio and subtitles: they are audio with "Multi Audio"
     or "Dual Audio", subtitles with "Multi Subs" alone, and when a release lists three or more
     with neither, only the first (or one a word names) is audio and the rest are subtitles,
     as in streaming rips that carry many subtitle tracks.
   Codes are pt-BR, pt, es-419 (Latin American Spanish), es, en, fr, it, de, ja, ko, zh, ru,
   hi, plus 'multi' for multi or dual audio (or many subtitles). */
var FLAG_LANG = {
  BR: 'pt-BR',
  PT: 'pt',
  ES: 'es',
  MX: 'es-419',
  AR: 'es-419',
  CO: 'es-419',
  CL: 'es-419',
  PE: 'es-419',
  VE: 'es-419',
  UY: 'es-419',
  US: 'en',
  GB: 'en',
  FR: 'fr',
  IT: 'it',
  DE: 'de',
  JP: 'ja',
  KR: 'ko',
  CN: 'zh',
  TW: 'zh',
  RU: 'ru',
  IN: 'hi'
};
/* words that name the audio */
var WORD_LANG = [
  ['pt-BR', /\b(dublado|pt[ ._-]?br|brazilian)\b/],
  ['pt', /\b(portugu[eê]se?|portugu[eê]s)\b/],
  ['es-419', /\b(latino|latam)\b/],
  ['es', /\b(castellano|spanish|espa[nñ]ol)\b/],
  ['en', /\b(english|eng)\b/],
  ['fr', /\b(french|truefrench|vff|vf2?)\b/],
  ['it', /\b(ita|italian|italiano)\b/],
  ['de', /\b(german|deutsch)\b/],
  ['ja', /\b(japanese|jpn)\b/],
  ['ko', /\b(korean)\b/],
  ['ru', /\b(russian|rus)\b/],
  ['hi', /\b(hindi)\b/]
];
/* a language as subtitle lists write it: "SUB ITA ENG", "Sub (rus eng)", "Subs: spa, por" */
var SUB_TOKEN = {
  en: 'en',
  eng: 'en',
  english: 'en',
  it: 'it',
  ita: 'it',
  italian: 'it',
  es: 'es',
  esp: 'es',
  spa: 'es',
  spanish: 'es',
  lat: 'es-419',
  pt: 'pt-BR',
  por: 'pt-BR',
  ptbr: 'pt-BR',
  bra: 'pt-BR',
  portuguese: 'pt-BR',
  fr: 'fr',
  fre: 'fr',
  fra: 'fr',
  french: 'fr',
  de: 'de',
  ger: 'de',
  deu: 'de',
  german: 'de',
  ja: 'ja',
  jap: 'ja',
  jpn: 'ja',
  japanese: 'ja',
  ko: 'ko',
  kor: 'ko',
  korean: 'ko',
  zh: 'zh',
  chi: 'zh',
  chs: 'zh',
  cht: 'zh',
  chinese: 'zh',
  ru: 'ru',
  rus: 'ru',
  russian: 'ru',
  hi: 'hi',
  hin: 'hi',
  hindi: 'hi'
};
/* the subtitle phrases of a name: their languages, and the name without them */
function subtitlePhrases(low) {
  var subs = [];
  function add(code) {
    if (code && subs.indexOf(code) < 0) subs.push(code);
  }
  /* "sub ita eng", "subs: spa, por", "subtitles (rus eng)" */
  var after = /\b(?:subs?|subtitles?|legendas?)\b[\s._:(\[-]*((?:[a-z]{2,10}(?:[\s._,+/&)\]-]+|$)){1,10})/g;
  low = low.replace(after, function (all, list) {
    var words = list.split(/[^a-z]+/),
      used = 0;
    for (var i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      if (!SUB_TOKEN[words[i]]) break;
      add(SUB_TOKEN[words[i]]);
      used++;
    }
    return used ? ' ' : all;
  });
  /* "eng subs", "spa sub", "esub" */
  low = low.replace(/\b([a-z]{2,10})[ ._-]?subs?\b/g, function (all, word) {
    if (word === 'e') return all;
    if (!SUB_TOKEN[word]) return all;
    add(SUB_TOKEN[word]);
    return ' ';
  });
  low = low.replace(/\be[ ._-]?subs?\b/g, function () {
    add('en');
    return ' ';
  });
  if (/\b(legendad[oa])\b/.test(low)) add('pt-BR');
  if (/\b(vostfr|vost)\b/.test(low)) add('fr');
  return { subs: subs, rest: low.replace(/\b(legendad[oa]|vostfr|vost)\b/g, ' ') };
}
function streamLanguageInfo(s) {
  var t = streamText(s),
    phrases = subtitlePhrases(t.toLowerCase()),
    low = phrases.rest,
    subs = phrases.subs,
    audio = [],
    flags = [],
    flag = /\uD83C([\uDDE6-\uDDFF])\uD83C([\uDDE6-\uDDFF])/g,
    m,
    i;
  function addTo(list, code) {
    if (code && list.indexOf(code) < 0) list.push(code);
  }
  while ((m = flag.exec(t))) {
    var cc = String.fromCharCode(m[1].charCodeAt(0) - 0xdde6 + 65, m[2].charCodeAt(0) - 0xdde6 + 65);
    addTo(flags, FLAG_LANG[cc]);
  }
  var named = [];
  for (i = 0; i < WORD_LANG.length; i++) if (WORD_LANG[i][1].test(low)) addTo(named, WORD_LANG[i][0]);
  var multiSubs = /\bmulti[ ._-]?subs?\b|\bmultisubs?\b/.test(low),
    multiAudio =
      /\b(multi[ ._-]?audio|dual[ ._-]?audio|dual)\b/.test(low) || /\bmulti\b(?![ ._-]?subs?)/.test(low);
  for (i = 0; i < named.length; i++) addTo(audio, named[i]);
  if (multiAudio) for (i = 0; i < flags.length; i++) addTo(audio, flags[i]);
  else if (multiSubs)
    for (i = 0; i < flags.length; i++) addTo(audio.indexOf(flags[i]) >= 0 ? audio : subs, flags[i]);
  else if (flags.length < 3) for (i = 0; i < flags.length; i++) addTo(audio, flags[i]);
  else
    for (i = 0; i < flags.length; i++) {
      /* many flags, nothing about audio: the first (or one a word names) is the audio */
      if (audio.indexOf(flags[i]) >= 0) continue;
      addTo(!audio.length && i === 0 ? audio : subs, flags[i]);
    }
  if (multiSubs && !subs.length) subs.push('multi');
  /* a language whose subtitles a word names, which no word gives as audio, is not the audio */
  var subBases = phrases.subs.map(langBase),
    namedBases = named.map(langBase);
  for (i = audio.length - 1; i >= 0; i--) {
    var base = langBase(audio[i]);
    if (subBases.indexOf(base) >= 0 && namedBases.indexOf(base) < 0 && !multiAudio) {
      addTo(subs, audio[i]);
      audio.splice(i, 1);
    }
  }
  if (multiAudio) addTo(audio, 'multi');
  /* "dublado" or a Brazilian flag says more than a plain "portuguese" */
  [audio, subs].forEach(function (list) {
    if (list.indexOf('pt-BR') >= 0 && list.indexOf('pt') >= 0) list.splice(list.indexOf('pt'), 1);
    if (list.indexOf('es-419') >= 0 && list.indexOf('es') >= 0) list.splice(list.indexOf('es'), 1);
  });
  return { audio: audio, subs: subs };
}
function streamLanguages(s) {
  return streamLanguageInfo(s).audio;
}
function langBase(code) {
  return String(code).split('-')[0];
}
/* the trackers an addon names go along with the address, for the engine to find peers */
function torrentTrackers(s) {
  var out = [];
  for (var i = 0; s.sources && i < s.sources.length && out.length < 12; i++) {
    var m = /^tracker:(.+)$/.exec(s.sources[i]);
    if (m) out.push('tr=' + encodeURIComponent(m[1]));
  }
  return out.length ? '?' + out.join('&') : '';
}
/* the addon's stream as the interface and the player use it; null when it cannot be played */
/* addonBase tells apart two installations of an addon with the same name */
/* A debrid service that already has the file, from how the addons name it: Torrentio's "[RD+]",
   Comet's "[TORBOX⚡]", "RD⚡" or "⚡ RD", MediaFusion's "⚡"; '' when it is not cached or not said.
   Such a source starts at once, without waiting for peers. */
var CACHED_SERVICES = [
  ['RD', /\b(rd|real[ -]?debrid)\b/i],
  ['AD', /\b(ad|all[ -]?debrid)\b/i],
  ['TB', /\b(tb|torbox)\b/i],
  ['PM', /\b(pm|premiumize)\b/i],
  ['DL', /\b(dl|debrid[ -]?link)\b/i],
  ['ED', /\b(ed|easy[ -]?debrid)\b/i],
  ['OC', /\b(oc|offcloud)\b/i],
  ['PK', /\b(pk|pikpak)\b/i]
];
function cachedService(s) {
  var name = String(s.name || ''),
    plus = name.match(/\[([A-Za-z]{2,10})\+\]/),
    bolt = /\u26A1/.test(name);
  if (!plus && !bolt) return '';
  var said = plus ? plus[1] : name;
  for (var i = 0; i < CACHED_SERVICES.length; i++)
    if (CACHED_SERVICES[i][1].test(said)) return CACHED_SERVICES[i][0];
  return 'debrid';
}
function sourceItem(s, addonName, addonBase) {
  var url = s.url,
    h = s.behaviorHints || {};
  if (!url && s.infoHash)
    url = 'http://127.0.0.1:11470/' + s.infoHash + '/' + (s.fileIdx || 0) + torrentTrackers(s);
  if (!url) return null;
  var item = {
    addon: addonName,
    addonBase: addonBase || '',
    name: s.name || '',
    title: s.title || s.description || '',
    url: url,
    quality: streamQuality(s),
    seeders: streamSeeders(s),
    filename: h.filename || '',
    bingeGroup: h.bingeGroup || '',
    notWebReady: !!h.notWebReady,
    headers: (h.proxyHeaders && h.proxyHeaders.request) || null
  };
  item.cached = cachedService(s);
  var languages = streamLanguageInfo(s);
  item.langs = languages.audio;
  item.subLangs = languages.subs;
  var compat = streamCompatibility(item);
  item.compatLabels = compat.labels;
  item.compatRank = compat.rank;
  return item;
}
/* what the local server keeps for a source it is about to play (server/stream-refs.js) */
function streamRefBody(s) {
  return {
    url: s.url,
    addon: s.addon || '',
    addonBase: s.addonBase || '',
    name: s.name || '',
    title: s.title || '',
    filename: s.filename || '',
    bingeGroup: s.bingeGroup || '',
    quality: s.quality || '',
    compat: (s.compatLabels || []).join(','),
    notWebReady: !!s.notWebReady,
    headers: s.headers || null,
    meta: s.meta || null
  };
}
function sourceTraits(value) {
  var t = String(value || '').toLowerCase(),
    out = [];
  var tests = [
    ['hevc', /\b(hevc|x265|h[ ._-]?265)\b/],
    ['h264', /\b(x264|h[ ._-]?264|avc)\b/],
    ['dv', /(dolby[ ._-]?vision|\bdovi\b|\bdv\b)/],
    ['hdr10p', /hdr10\+/],
    ['hdr', /\bhdr\b/],
    ['10bit', /\b(10[ ._-]?bit|main[ ._-]?10)\b/],
    ['eac3', /\b(eac3|e[ ._-]?ac[ ._-]?3|ddp|dd\+)\b/],
    ['ac3', /\b(ac3|dolby[ ._-]?digital)\b/],
    ['aac', /\baac\b/],
    ['dts', /\bdts\b/],
    ['atmos', /\batmos\b/],
    ['webdl', /web[ ._-]?dl/],
    ['bluray', /blu[ ._-]?ray|bdrip/]
  ];
  for (var i = 0; i < tests.length; i++) if (tests[i][1].test(t)) out.push(tests[i][0]);
  return out;
}
/* How well a source keeps the audio language being watched; -1000 rules it out. A release
   with a named language must not become another one, and an unnamed one may be the original
   audio, so changing a dub for it is left to the viewer. Older saved preferences have no
   language and are not judged. */
function nextLanguageFit(wanted, s) {
  if (!wanted) return 0;
  var have = s.langs || [],
    named = [],
    score = 0,
    i;
  for (i = 0; i < wanted.length; i++) if (wanted[i] !== 'multi') named.push(wanted[i]);
  if (!named.length) {
    if (wanted.length) return have.indexOf('multi') >= 0 ? 40 : 0;
    /* nothing named in the episode being watched: prefer sources that name nothing either */
    return have.length ? -15 : 0;
  }
  for (i = 0; i < named.length; i++) {
    if (have.indexOf(named[i]) >= 0) score += 40;
    else
      for (var h = 0; h < have.length; h++)
        if (langBase(have[h]) === langBase(named[i])) {
          score += 25;
          break;
        }
  }
  if (score) return score;
  return have.indexOf('multi') >= 0 ? 5 : -1000;
}
/* The source to carry on with: the addon's own marker for "same release" (bingeGroup, as the
   official apps use it) settles it; without one, the same addon and quality, then the closest
   release. Null when nothing fits, so the viewer chooses from the list. */
function matchingNextSource(items, pref) {
  if (!pref || !pref.addon) return null;
  var wanted = sourceTraits((pref.text || '') + ' ' + (pref.compat || '')),
    best = null,
    bestScore = -9999,
    i,
    s;
  if (pref.binge)
    for (i = 0; i < items.length; i++)
      if (!items[i].stored && items[i].addon === pref.addon && items[i].bingeGroup === pref.binge)
        return items[i];
  if (!pref.quality) return null;
  for (i = 0; i < items.length; i++) {
    s = items[i];
    /* an archive cannot play (streamCompatibility) */
    if (s.stored || s.addon !== pref.addon || s.quality !== pref.quality || s.compatRank >= 4) continue;
    var fit = nextLanguageFit(pref.langs, s);
    if (fit <= -1000) continue;
    var traits = sourceTraits(streamText(s) + ' ' + (s.compatLabels || []).join(' ')),
      score = fit;
    for (var w = 0; w < wanted.length; w++) if (traits.indexOf(wanted[w]) >= 0) score += 12;
    score -= (s.compatRank || 0) * 20;
    if (s.seeders > 0) score += Math.min(15, Math.floor(Math.log(s.seeders + 1) / Math.LN2));
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
// Poster, backdrop and icon URLs, the look that decides their sizes, and the Simple mode.
/* the look this TV had before anyone chose: light on the TVs the profile already treats as small.
   The modern look of the 4.0 tests is gone: a TV that chose it has the standard one. */
var PROFILE_LOW_MEMORY = !!TV_PROFILE.lowMemory;
function uiLook() {
  return lsRaw('uiLook', '') === 'light' || (!lsRaw('uiLook', '') && PROFILE_LOW_MEMORY)
    ? 'light'
    : 'standard';
}
/* how many titles Discover keeps loading (Settings); small TVs start lower */
var DISCOVER_CACHED = 80;
function discoverMax() {
  var chosen = parseInt(lsRaw('discoverMax', ''), 10);
  if (chosen > 0) return chosen;
  return (TV_PROFILE.discoverCap || 80) < 80 ? 80 : 200;
}
/* Simple: fewer choices on screen (Settings) */
function simpleMode() {
  return lsRaw('uiMode', 'full') === 'simple';
}
function isImdb(id) {
  return String(id || '').indexOf('tt') === 0;
}
/* a title's logo: its own, or the one Stremio's picture service keeps for an IMDb title */
function logoOf(it) {
  if (it.logo) return it.logo;
  return isImdb(it.id) ? 'https://images.metahub.space/logo/medium/' + it.id + '/img' : '';
}
function posterOf(it) {
  if (it.poster) return it.poster;
  return isImdb(it.id) ? 'https://images.metahub.space/poster/small/' + it.id + '/img' : '';
}
/* RPDB posters print their ratings along the bottom edge, so a labelled card shows its title under
   the poster instead of over it; a grid's rows grow by that line (titleUnderExtra) */
function titleUnder(it) {
  return !!it && /ratingposterdb\.com/i.test(posterOf(it));
}
function titleUnderExtra(it) {
  return titleUnder(it) ? ((document.documentElement.clientHeight || 1080) <= 800 ? 26 : 36) : 0;
}
var ICON = {
  exit: '<svg viewBox="0 0 24 24"><path d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5zM4 3h8v2H4v14h8v2H4a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
  similar: '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>',
  trailer:
    '<svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 16.17l-3.88-3.88L3.7 13.7 9 19 21 7l-1.41-1.42z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  close:
    '<svg viewBox="0 0 24 24"><path d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>'
};
function bgOf(it) {
  if (it.background) return it.background;
  if (isImdb(it.id)) return 'https://images.metahub.space/background/medium/' + it.id + '/img';
  return it.poster || '';
}
function bgSmall(it) {
  var u = String(bgOf(it) || '');
  return u.replace(/(images\.metahub\.space\/background\/)[a-z]+\//, '$1small/');
}
/* The width the local server reduces a background to: smaller in the light look, the
   package's own otherwise. */
function bgWidth() {
  return uiLook() === 'light' ? 640 : 0;
}
/* sharp: the featured titles' wider background, 1280 px, except on small TVs and in the light look */
function bgMid(it, sharp) {
  var u = String(bgOf(it) || '');
  if (!u) return u;
  /* reducing the image takes FFmpeg: without it, the smaller version from the artwork server */
  if (!HAS_MEDIA_TOOLS) return bgSmall(it);
  var width = sharp && !TV_PROFILE.lowMemory && uiLook() !== 'light' ? 1280 : bgWidth(),
    size = width >= 1280 ? 'large' : 'medium';
  return (
    '/artwork?u=' +
    encodeURIComponent(u.replace(/(images\.metahub\.space\/background\/)[a-z]+\//, '$1' + size + '/')) +
    (width ? '&w=' + width : '')
  );
}
// Stremio account session and library synchronization.
/* ================= account / library ================= */
function user() {
  return lsJson('user');
}
function authKey() {
  return lsJson('authKey');
}
/* signed in with a Nuvio account (experimental): the local server answers its calls */
function isNuvioAccount() {
  return /^nuvio:/.test(String(authKey() || ''));
}
/* Library / Continue Watching / watched all sync to the Stremio account, exactly like
   the official apps: items live under lib_<first4 of user._id>_<id> (shared with the
   classic shell on this origin), pulled on boot and pushed on every change. */
function libPrefix() {
  var u = user();
  if (u && u._id) return 'lib_' + u._id.slice(0, 4) + '_';
  var keys = storageKeys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf('lib_') === 0) {
      var j = k.indexOf('_', 4);
      if (j > 0) return k.slice(0, j + 1);
    }
  }
  return 'lib_local_';
}
var PRE = libPrefix();
window.__SC_PHASE__('M1');
function allLib() {
  var out = [],
    keys = storageKeys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf(PRE) !== 0) continue;
    var it = lsJson(k);
    if (it && it._id) out.push(it);
  }
  return out;
}
/* whole minutes left, or 0 when the numbers cannot be trusted */
function watchMinutesLeft(offsetMs, durationMs) {
  if (!(durationMs > 0) || !(offsetMs > 60000) || offsetMs >= durationMs) return 0;
  return Math.max(1, Math.round((durationMs - offsetMs) / 60000));
}
/* the episode the player recorded as next when this one finished */
function upNextOf(id, vid) {
  var next = lsRaw('tvnext_' + id + '_' + vid, '');
  return next && next !== vid ? next : '';
}
/* A series item whose position sits at the very start points at its next episode: the
   official apps move it there (position 1 ms) once an episode is finished. */
function upNextPointer(it) {
  var s = it.state || {};
  return it.type === 'series' && s.video_id && s.timeOffset > 0 && s.timeOffset < 60000 ? s.video_id : '';
}
/* Continue Watching card data: a finished episode becomes its next episode, and the
   minutes left are only shown when the saved numbers can be trusted. */
function cwCard(it) {
  var s = it.state || {},
    next = upNextPointer(it) || (watchFinished(s.timeOffset, s.duration) ? upNextOf(it._id, s.video_id) : '');
  return {
    id: it._id,
    type: it.type || 'movie',
    name: it.name,
    poster: it.poster,
    background: it.background,
    videoId: next || s.video_id || it._id,
    progress: next ? 0 : s.duration > 0 ? s.timeOffset / s.duration : 0,
    minutesLeft: next ? 0 : watchMinutesLeft(s.timeOffset, s.duration),
    upNext: !!next,
    cw: true
  };
}
window.__SC_CW_CARD__ = cwCard;
/* the day an episode airs, short: "Tue 24 Nov" */
function airDay(at) {
  try {
    return new Date(at).toLocaleDateString(UI_LANG, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch (e) {
    return new Date(at).toISOString().slice(5, 10);
  }
}
/* "Up next · S2 E6", "S2 E5 · 12 min left" or "48 min left" under a Continue Watching title */
function cwSubtitle(it) {
  var ep = '';
  if (it.videoId && it.videoId.indexOf(':') > 0) {
    var pp = it.videoId.split(':');
    if (pp.length >= 3) {
      if (it.upNext) return tx('cwUpNext', pp[pp.length - 2], pp[pp.length - 1]);
      if (it.airsAt) return tx('upcomingTag', pp[pp.length - 2], pp[pp.length - 1], airDay(it.airsAt));
      if (it.fresh) return tx('newEpisodeTag', pp[pp.length - 2], pp[pp.length - 1]);
      ep = tx('cwEpisode', pp[pp.length - 2], pp[pp.length - 1]);
    }
  }
  var left = it.minutesLeft ? tx('cwLeft', it.minutesLeft) : '';
  return ep && left ? ep + '  ·  ' + left : ep || left;
}
/* As in Stremio, an item removed from the library stays only while it is temporary */
function cwItems(limit) {
  var out = [],
    lib = allLib();
  for (var i = 0; i < lib.length; i++) {
    var it = lib[i],
      s = it.state || {};
    if ((it.removed && !it.temp) || isLiveType(it.type)) continue;
    if (!upNextPointer(it)) {
      if (!s.timeOffset || s.timeOffset < 60000) continue;
      /* a finished episode stays only when its next episode is known (cwCard) */
      if (watchFinished(s.timeOffset, s.duration) && !(it.type === 'series' && upNextOf(it._id, s.video_id)))
        continue;
    }
    if (!it.name) continue;
    out.push(it);
  }
  out.sort(function (a, b) {
    return String(b._mtime || '').localeCompare(String(a._mtime || ''));
  });
  return out.slice(0, limit || 12);
}
window.__SC_CW_ITEMS__ = cwItems;
function libGridItems() {
  var out = [],
    lib = allLib();
  for (var i = 0; i < lib.length; i++) {
    var it = lib[i];
    if (it.removed || isLiveType(it.type)) continue;
    if (!it.name) continue;
    out.push(it);
  }
  out.sort(function (a, b) {
    return String(b._mtime || '').localeCompare(String(a._mtime || ''));
  });
  return out.slice(0, TV_PROFILE.libraryCap);
}
/* pull the account library on boot: newest-mtime-wins, then rebuild the boards */
/* a modification time as milliseconds, from a number or an ISO string */
function mtimeMs(v) {
  if (typeof v === 'number') return v;
  var t = Date.parse(v || '');
  return isNaN(t) ? 0 : t;
}
window.__SC_MTIME_MS__ = mtimeMs;
function pullLib(cb) {
  var ak = authKey();
  if (!ak) {
    if (cb) cb();
    return;
  }
  postJson(API + '/api/datastoreMeta', { authKey: ak, collection: 'libraryItem' }, function (r) {
    var rows = r && r.result;
    if (!rows || !rows.length) {
      if (cb) cb();
      return;
    }
    /* datastoreMeta returns modification times in milliseconds while items carry ISO
       strings, so both are compared as times (a text comparison never pulled anything
       that already existed here). Items newer here than on the account, or missing
       there, are pushed back: a push lost when the player closed is not lost for good. */
    var want = [],
      onServer = {},
      push = [];
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i][0],
        mt = mtimeMs(rows[i][1]),
        loc = lsJson(PRE + id);
      onServer[id] = 1;
      if (!loc || mtimeMs(loc._mtime) < mt) {
        if (want.length < 150) want.push(id);
      } else if (mtimeMs(loc._mtime) > mt + 1000 && push.length < 50) push.push(loc);
    }
    var local = allLib();
    for (var l = 0; l < local.length && push.length < 50; l++) {
      var li = local[l],
        ls = li.state || {};
      if (li._id && !onServer[li._id] && (li.removed === false || ls.timeOffset > 0)) push.push(li);
    }
    pushLibItems(push);
    if (!want.length) {
      if (cb) cb();
      return;
    }
    postJson(
      API + '/api/datastoreGet',
      { authKey: ak, collection: 'libraryItem', ids: want, all: false },
      function (g) {
        var items = g && g.result;
        if (items && items.length)
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it && it._id) lsSet(PRE + it._id, it);
          }
        if (cb) cb();
      }
    );
  });
}
/* push one library item up to the account (datastorePut = how Stremio persists it) */
/* Signing out: the account is told, and what this TV kept of it is forgotten */
function signOut() {
  var ak = authKey();
  postJson(API + '/api/logout', { authKey: ak }, function () {}, 4000);
  var kill = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (
      k === 'authKey' ||
      k === 'user' ||
      k === 'profileFace' ||
      k === 'newEpisodes' ||
      k === 'addons' ||
      k === 'addonsLastModified' ||
      k === 'blib_migrated' ||
      k.indexOf('lib_') === 0 ||
      k.indexOf('blib_') === 0 ||
      k.indexOf('subs_') === 0 ||
      k.indexOf('tvstream_') === 0 ||
      k.indexOf('beta_') === 0
    )
      kill.push(k);
  }
  for (var j = 0; j < kill.length; j++) {
    try {
      localStorage.removeItem(kill[j]);
    } catch (e) {}
  }
}
/* After a sign-in: the key, then the account's user and addons; done(true) for a Nuvio
   account, which asks whose profile it is first. Addons that take long are not waited for
   more than 4 s once the account answered. */
function completeSignIn(ak, user, done) {
  lsSet('authKey', ak);
  if (user) lsSet('user', user);
  if (isNuvioAccount()) return done(true);
  postJson(API + '/api/getUser', { authKey: ak }, function (j) {
    if (j && j.result) lsSet('user', j.result);
    var called = false;
    function once() {
      if (called) return;
      called = true;
      done(false);
    }
    syncAddons(once);
    setTimeout(once, 4000);
  });
}
function pushLib(item) {
  if (item && item._id) pushLibItems([item]);
}
function pushLibItems(items) {
  var ak = authKey();
  if (!ak || !items || !items.length) return;
  postJson(
    API + '/api/datastorePut',
    { authKey: ak, collection: 'libraryItem', changes: items },
    function () {},
    9000
  );
}
// Account addon collection.
/* addons: silent pull from the account at every boot (no buttons needed) */
/* The list holds every addon's whole manifest (often hundreds of KB): it is read once and kept while
   the stored text is the same, instead of parsed again for each folder and row of Home, which on a
   weak TV kept the native app's server busy for minutes. Callers only read it. */
var addonsRead = { raw: undefined, list: [] };
function addons() {
  var raw = null;
  try {
    raw = localStorage.getItem('addons');
  } catch (e) {}
  if (raw !== addonsRead.raw) {
    addonsRead.raw = raw;
    try {
      addonsRead.list = JSON.parse(raw || 'null') || [];
    } catch (e) {
      addonsRead.list = [];
    }
  }
  return addonsRead.list;
}
/* The addons asked for catalogs, metadata and sources: all but Local files, which the
   streaming server serves for a computer's own video folders. The TV has none, so asking
   it only costs requests and "did not answer" entries in Diagnostics. */
function remoteAddons() {
  var all = addons(),
    out = [];
  for (var i = 0; i < all.length; i++)
    if (
      !/^https?:\/\/(?:127\.0\.0\.1|localhost):11470\//i.test(String((all[i] && all[i].transportUrl) || ''))
    )
      out.push(all[i]);
  return out;
}
/* Nuvio Collections of the profile (folders of catalogs), kept for the Home rows */
function nuvioCollections() {
  return isNuvioAccount() ? lsJson('nuvioCollections') || [] : [];
}
function syncCollections(cb) {
  var ak = authKey();
  if (!ak || !isNuvioAccount()) {
    if (cb) cb(false);
    return;
  }
  postJson(API + '/api/collectionsGet', { authKey: ak }, function (r) {
    var got = r && r.result;
    if (!got || typeof got.length !== 'number') {
      if (cb) cb(false);
      return;
    }
    /* the Home order kept by Nuvio: catalogs and collections mixed, each one on or off */
    lsSet('nuvioHome', { items: r.home || [], showType: r.showType !== false });
    var cur = '';
    try {
      cur = localStorage.getItem('nuvioCollections') || '';
    } catch (e) {}
    var next = JSON.stringify(got);
    if (next !== cur) {
      lsRawSet('nuvioCollections', next);
      if (cb) cb(true);
    } else if (cb) cb(false);
  });
}
function syncAddons(cb) {
  var ak = authKey();
  if (!ak) {
    if (cb) cb(false);
    return;
  }
  postJson(API + '/api/addonCollectionGet', { authKey: ak, update: true }, function (r) {
    var got = r && r.result && r.result.addons;
    if (!got || !got.length) {
      if (cb) cb(false);
      return;
    }
    var cur = '';
    try {
      cur = localStorage.getItem('addons') || '';
    } catch (e) {}
    var next = JSON.stringify(got);
    if (next !== cur) {
      lsRawSet('addons', next);
      lsRawSet('addonsLastModified', String(Date.now()));
      if (cb) cb(true);
    } else if (cb) cb(false);
  });
}
// Catalog discovery from installed addons (Home rows, Discover filters).
/* ================= addon-driven catalogs ================= */
/* the query string of the installed addon whose base is `base` ('' for Cinemeta or none) */
function addonQueryFor(list, base) {
  for (var i = 0; i < (list || []).length; i++)
    if (list[i] && addonBase(list[i]) === base) return addonQuery(list[i]);
  return '';
}
function typeLabel(t) {
  var value = String(t || '');
  if (value === 'movie') return tx('movies');
  if (value === 'series') return tx('series');
  if (value === 'anime') return tx('anime');
  value = value.replace(/[_-]+/g, ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : tx('other');
}
function discoverCatalogInfo(cat) {
  var ex = (cat && cat.extra) || [],
    blocked = false,
    genreOptions = [],
    genreRequired = false;
  for (var e = 0; e < ex.length; e++) {
    var x = ex[e] || {},
      name = String(x.name || '');
    if (x.isRequired && name !== 'genre') blocked = true;
    if (name === 'genre') {
      genreRequired = !!x.isRequired;
      if (x.options && x.options.length) genreOptions = x.options.slice(0);
    }
  }
  if (cat && cat.extraRequired && cat.extraRequired.length)
    for (var er = 0; er < cat.extraRequired.length; er++)
      if (cat.extraRequired[er] !== 'genre') blocked = true;
  return { blocked: blocked, genreOptions: genreOptions, genreRequired: genreRequired };
}
function discoverTypes() {
  var values = ['movie', 'series'],
    seen = { movie: true, series: true },
    a = remoteAddons();
  for (var i = 0; i < a.length; i++) {
    var man = a[i] && a[i].manifest;
    if (!man || !man.catalogs) continue;
    for (var c = 0; c < man.catalogs.length; c++) {
      var cat = man.catalogs[c],
        type = String((cat && cat.type) || '');
      if (!type || cat.id == null || seen[type] || discoverCatalogInfo(cat).blocked) continue;
      seen[type] = true;
      values.push(type);
    }
  }
  var out = [];
  for (var n = 0; n < values.length; n++) out.push({ value: values[n], label: typeLabel(values[n]) });
  return out;
}
window.__SC_DISCOVER_TYPES__ = discoverTypes;
function stableHash(value) {
  var s = String(value || ''),
    h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(36);
}
function catalogCacheKey(addon, cat) {
  var m = (addon && addon.manifest) || {};
  return (
    'v2_' +
    stableHash([m.id || '', addonBase(addon || {}), (cat && cat.type) || '', (cat && cat.id) || ''].join('|'))
  );
}
var CATALOG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
/* Nuvio Collections of the profile, pinned ones first, in the order Nuvio keeps them */
function orderedCollections() {
  var cols = nuvioCollections(),
    out = [],
    i;
  for (i = 0; i < cols.length; i++) if (cols[i] && cols[i].pinToTop) out.push(cols[i]);
  for (i = 0; i < cols.length; i++) if (cols[i] && !cols[i].pinToTop) out.push(cols[i]);
  return out;
}
/* The sources of a Collections folder: one per source that points at an installed addon catalog,
   with what a page of it needs ({ base, type, id, query, genre }); TMDB and Trakt sources need
   Nuvio's own feeds, so they come marked unavailable. */
function folderSources(folder) {
  var a = remoteAddons(),
    byId = {},
    out = [],
    showType = (lsJson('nuvioHome') || {}).showType;
  for (var i = 0; i < a.length; i++) {
    var man = a[i] && a[i].manifest;
    if (man && man.id && !byId[man.id]) byId[man.id] = a[i];
  }
  var sources = folder.sources && folder.sources.length ? folder.sources : folder.catalogSources || [];
  for (var s = 0; s < sources.length && out.length < (TV_PROFILE.catalogRowsCap || 16); s++) {
    var src = sources[s] || {};
    if (src.provider && src.provider !== 'addon') {
      out.push({ title: src.title || src.provider, unavailable: true });
      continue;
    }
    var addon = byId[src.addonId],
      cats = (addon && addon.manifest.catalogs) || [],
      cat = null,
      byIdOnly = null;
    for (var k = 0; k < cats.length; k++) {
      if (!cats[k] || String(cats[k].id) !== String(src.catalogId)) continue;
      if (cats[k].type === src.type) cat = cats[k];
      else if (!byIdOnly) byIdOnly = cats[k];
    }
    /* the same catalog under another type (anime kept as series, say) still counts */
    cat = cat || byIdOnly;
    /* an addon or catalog not here keeps its place, marked, so the folder never disappears */
    if (!cat) {
      out.push({
        title: (addon && addon.manifest.name) || src.addonId || '?',
        unavailable: true,
        missing: true
      });
      continue;
    }
    /* Nuvio stores "no genre" as the text None (or null) */
    var genre = src.genre ? String(src.genre).trim() : '';
    if (/^(none|null|undefined)$/i.test(genre)) genre = '';
    out.push({
      title:
        (cat.name || folder.title || '') +
        (genre ? ' · ' + genre : '') +
        (showType ? ' · ' + typeLabel(cat.type) : ''),
      base: addonBase(addon),
      type: cat.type,
      id: String(cat.id),
      query: addonQuery(addon),
      genre: genre,
      key: catalogCacheKey(addon, cat) + (genre ? '_' + stableHash(genre) : '')
    });
  }
  return out;
}
/* a folder as a Home of rows (viewMode ROWS): one row per available source */
function folderRowDefs(folder) {
  var out = [],
    sources = folderSources(folder);
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i];
    if (s.unavailable) continue;
    out.push({ title: s.title, type: s.type, url: discoverPageUrl(s, s.genre, 0), key: s.key });
  }
  return out;
}
/* how a folder page shows: tabs over a grid (Nuvio's default) or rows; "All" first when there is
   more than one source and the folder asks for it */
function folderView(folder) {
  var sources = folderSources(folder),
    usable = sources.filter(function (s) {
      return !s.unavailable;
    });
  return {
    title: folder.title || '',
    cover: folder.coverImageUrl || '',
    rows: folder.viewMode === 'ROWS',
    all: folder.showAllTab !== false && usable.length > 1,
    sources: sources
  };
}
/* Home rows for the Collections: one row of folder tiles per collection (no requests until a
   folder is opened), only folders that have something to show. A tile is drawn as Nuvio asks:
   poster, square or wide, its cover, else its emoji, else the first letters of its name. */
function collectionTileDefs() {
  var cols = orderedCollections(),
    out = [];
  for (var c = 0; c < cols.length; c++) {
    var tiles = [],
      folders = cols[c].folders || [];
    for (var f = 0; f < folders.length; f++) {
      var folder = folders[f];
      if (!folder || !folderSources(folder).length) continue;
      /* Nuvio's own default shape is square */
      var shape = String(folder.tileShape || 'square').toLowerCase();
      tiles.push({
        folder: folder,
        id: 'folder:' + (folder.id || cols[c].title + '/' + folder.title),
        type: 'folder',
        name: folder.hideTitle ? '' : folder.title || '',
        poster: folder.coverImageUrl || '',
        shape: shape === 'landscape' || shape === 'wide' ? 'wide' : shape === 'square' ? 'square' : 'poster',
        glyph:
          folder.coverEmoji ||
          String(folder.title || '?')
            .slice(0, 2)
            .toUpperCase()
      });
    }
    if (tiles.length)
      out.push({
        title: cols[c].title || '',
        tiles: tiles,
        key: 'collection_' + cols[c].id,
        pinned: !!cols[c].pinToTop
      });
  }
  return out;
}
/* Collections and catalog rows in the order Nuvio keeps (each one on or off, with its own title);
   pinned collections first, and what Nuvio does not name after the rest */
function nuvioHomeOrder(cols, cats) {
  var items = (lsJson('nuvioHome') || {}).items || [],
    rank = {},
    all = cols.concat(cats),
    out = [];
  for (var i = 0; i < items.length; i++) rank[items[i].key] = items[i];
  for (var a = 0; a < all.length; a++) {
    var row = all[a],
      said = rank[row.nkey || row.key];
    if (said && !said.enabled) continue;
    if (said && said.title) row.title = said.title;
    out.push({ row: row, at: row.pinned ? -1 : said ? said.order : 100000 + a });
  }
  out.sort(function (x, y) {
    return x.at - y.at;
  });
  return out.map(function (x) {
    return x.row;
  });
}
/* every addon catalog that can be a Home row, in the addons' order */
function boardCatalogs() {
  var out = [],
    a = remoteAddons();
  for (var i = 0; i < a.length; i++) {
    var man = a[i] && a[i].manifest;
    if (!man || !man.catalogs) continue;
    var base = addonBase(a[i]);
    for (var c = 0; c < man.catalogs.length; c++) {
      var cat = man.catalogs[c];
      if (!cat || !cat.type || cat.id == null) continue;
      var req = false,
        ex = cat.extra || [];
      for (var e = 0; e < ex.length; e++) if (ex[e] && ex[e].isRequired) req = true;
      if (cat.extraRequired && cat.extraRequired.length) req = true;
      if (req) continue; /* search/genre-required catalogs are not board rows (og rule) */
      out.push({
        title: (cat.name ? cat.name + ' · ' : '') + typeLabel(cat.type),
        type: cat.type,
        url: base + '/catalog/' + cat.type + '/' + encodeURIComponent(cat.id) + '.json' + addonQuery(a[i]),
        key: catalogCacheKey(a[i], cat),
        /* the name Nuvio's Home order uses for it */
        nkey: man.id + ':' + cat.type + ':' + cat.id
      });
    }
  }
  return out;
}
function homeCatalogs() {
  return arrangeRows(boardCatalogs()).slice(0, TV_PROFILE.catalogRowsCap || 16);
}
/* ---------- the Home rows as the viewer arranged them (Settings > Organize catalogs) ---------- */
/* { order: [row keys], hidden: [row keys] }; rows not named keep their place after the others */
function homeLayout() {
  var l = lsJson('homeLayout') || {};
  return { order: l.order || [], hidden: l.hidden || [] };
}
function arrangeRows(rows, keepHidden) {
  var l = homeLayout(),
    placed = [];
  for (var i = 0; i < rows.length; i++) {
    var at = l.order.indexOf(rows[i].key);
    placed.push({ row: rows[i], rank: at < 0 ? l.order.length + i : at });
  }
  placed.sort(function (a, b) {
    return a.rank - b.rank;
  });
  var out = [];
  for (var p = 0; p < placed.length; p++)
    if (keepHidden || l.hidden.indexOf(placed[p].row.key) < 0) out.push(placed[p].row);
  return out;
}
/* every row Home can show, in the viewer's order, with the hidden ones marked */
function homeRowChoices() {
  var hidden = homeLayout().hidden,
    rows = arrangeRows(boardCatalogs(), true),
    out = [];
  for (var r = 0; r < rows.length; r++)
    out.push({ key: rows[r].key, title: rows[r].title, hidden: hidden.indexOf(rows[r].key) >= 0 });
  return out;
}
/* rows: [{ key, hidden }] in the order wanted */
function saveHomeLayout(rows) {
  var order = [],
    hidden = [];
  for (var i = 0; i < rows.length; i++) {
    order.push(String(rows[i].key));
    if (rows[i].hidden) hidden.push(String(rows[i].key));
  }
  lsSet('homeLayout', { order: order, hidden: hidden });
}
/* HOME rows = YOUR addon catalogs (in order); Cinemeta defaults if none configured */
function homeDefs() {
  var cols = collectionTileDefs(),
    cats = homeCatalogs();
  /* with Nuvio Collections, Home mixes them with the catalogs as Nuvio's apps do */
  if (cols.length) return nuvioHomeOrder(cols, cats);
  if (!cats.length)
    cats = [
      {
        title: tx('popularMovies'),
        type: 'movie',
        url: CIN + '/catalog/movie/top.json',
        key: 'cin_m_top',
        ranked: true
      },
      { title: tx('popularSeries'), type: 'series', url: CIN + '/catalog/series/top.json', key: 'cin_s_top' },
      { title: tx('topMovies'), type: 'movie', url: CIN + '/catalog/movie/imdbRating.json', key: 'cin_m_ir' },
      {
        title: tx('topSeries'),
        type: 'series',
        url: CIN + '/catalog/series/imdbRating.json',
        key: 'cin_s_ir'
      }
    ];
  /* an addon's own "popular" catalog ranks its first ten too */
  for (var i = 0; i < cats.length; i++)
    if (/\/catalog\/[^\/]+\/top\.json$/.test(cats[i].url || '')) {
      cats[i].ranked = true;
      break;
    }
  return cats;
}
/* The rows Home starts with, from this TV's library: Continue Watching, then the new episodes
   of followed series and the titles added to the library, which otherwise only appear in the
   Library section. wide rows show landscape cards. */
/* What the screensaver shows: the backdrops of what the viewer is watching, waits for and keeps */
var SAVER_MAX = 30;
function screensaverItems() {
  var out = [],
    seen = {};
  function add(it) {
    var id = it && (it.id || it._id),
      background = id && bgOf(it);
    if (!background || seen[id] || out.length >= SAVER_MAX) return;
    seen[id] = 1;
    out.push({ id: id, name: it.name || '', background: background });
  }
  cwItems().forEach(add);
  newEpisodeItems().forEach(add);
  upcomingItems().forEach(add);
  libGridItems().forEach(add);
  return out;
}
/* Settings > Screensaver: minutes without a key before it shows, 0 never */
function screensaverMinutes() {
  return parseInt(lsRaw('screensaver', '5'), 10) || 0;
}
function homeLibraryRows() {
  var rows = [],
    cw = cwItems(),
    cwMapped = [];
  for (var c = 0; c < cw.length; c++) cwMapped.push(cwCard(cw[c]));
  if (cwMapped.length) rows.push({ title: tx('continueWatching'), items: cwMapped, wide: true });
  var fresh = newEpisodeItems();
  if (fresh.length) rows.push({ title: tx('newEpisodes'), items: fresh, wide: true });
  var soon = upcomingItems();
  if (soon.length) rows.push({ title: tx('upcomingRow'), items: soon, wide: true });
  var mine = libGridItems().slice(0, 20),
    mineMapped = [];
  for (var mi = 0; mi < mine.length; mi++)
    mineMapped.push({
      id: mine[mi]._id,
      type: mine[mi].type,
      name: mine[mi].name,
      poster: mine[mi].poster,
      background: mine[mi].background
    });
  if (mineMapped.length) rows.push({ title: tx('myList'), items: mineMapped, wide: false });
  return rows;
}
function discoverCatalogs(type) {
  var out = [],
    seen = {},
    a = remoteAddons();
  for (var i = 0; i < a.length; i++) {
    var man = a[i] && a[i].manifest;
    if (!man || !man.catalogs) continue;
    var base = addonBase(a[i]);
    for (var c = 0; c < man.catalogs.length; c++) {
      var cat = man.catalogs[c];
      if (!cat || cat.type !== type || cat.id == null) continue;
      var info = discoverCatalogInfo(cat);
      if (info.blocked) continue;
      var key = [base, type, cat.id].join('|');
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        label: cat.name || man.name || String(cat.id),
        type: type,
        id: String(cat.id),
        base: base,
        query: addonQuery(a[i]),
        key: catalogCacheKey(a[i], cat),
        genres: info.genreOptions,
        genreRequired: info.genreRequired
      });
    }
  }
  if (!out.length && (type === 'movie' || type === 'series')) {
    out.push({
      label: tx('popular'),
      type: type,
      id: 'top',
      base: CIN,
      key: 'fallback_top',
      genres: [],
      genreRequired: false
    });
    out.push({
      label: tx('topRated'),
      type: type,
      id: 'imdbRating',
      base: CIN,
      key: 'fallback_rating',
      genres: [],
      genreRequired: false
    });
  }
  return out;
}
/* DISCOVER rows = trending + top + a spread of genres */
var DGEN = [
  ['Action', 'genreAction'],
  ['Comedy', 'genreComedy'],
  ['Sci-Fi', 'genreSciFi'],
  ['Drama', 'genreDrama'],
  ['Horror', 'genreHorror']
];
function discoverGenres(cat) {
  var out = [],
    values = cat && cat.genres && cat.genres.length ? cat.genres : null;
  if (!cat || !cat.genreRequired) out.push({ value: '', label: tx('allGenres') });
  if (values) {
    for (var i = 0; i < values.length; i++) out.push({ value: String(values[i]), label: String(values[i]) });
  } else if (cat && (cat.genreRequired || cat.base === CIN))
    for (var n = 0; n < DGEN.length; n++) out.push({ value: DGEN[n][0], label: tx(DGEN[n][1]) });
  return out;
}
/* a page of a Discover catalog, in a genre ('' for all), from the title number offset */
function discoverPageUrl(cat, genre, offset) {
  var extra = [];
  if (!cat) return '';
  if (genre) extra.push('genre=' + encodeURIComponent(genre));
  if (offset > 0) extra.push('skip=' + offset);
  return (
    cat.base +
    '/catalog/' +
    cat.type +
    '/' +
    encodeURIComponent(cat.id) +
    (extra.length ? '/' + extra.join('&') : '') +
    '.json' +
    (cat.query || '')
  );
}
function getCatalogUrl(url, key, type, cb) {
  var ck = 'beta_cat_' + key,
    cached = lsJson(ck);
  if (
    cached &&
    cached.v === 2 &&
    cached.t &&
    Date.now() - cached.t < CATALOG_CACHE_TTL &&
    cached.items &&
    cached.items.length
  )
    cb(cached.items, true);
  else cached = null;
  xhrJson(url, function (j) {
    var metas = (j && j.metas) || [];
    if (!metas.length) {
      if (!cached) cb([], false);
      return;
    }
    var slim = [];
    for (var i = 0; i < Math.min(metas.length, TV_PROFILE.catalogCap); i++) {
      var m = metas[i];
      slim.push({ id: m.id, type: m.type || type, name: m.name, poster: m.poster, background: m.background });
    }
    var same = cached && cached.items && JSON.stringify(cached.items) === JSON.stringify(slim);
    lsSet(ck, { v: 2, t: Date.now(), items: slim });
    if (!same) cb(slim, false); /* identical to cache -> skip the double row rebuild at boot */
  });
}
// Collections folders by id, for the native interface (the server opens a folder by its id).
/* a folder of the profile's Collections by its id */
function findFolder(id) {
  var cols = nuvioCollections();
  for (var c = 0; c < cols.length; c++)
    for (var f = 0; f < ((cols[c] && cols[c].folders) || []).length; f++)
      if (String(cols[c].folders[f].id) === String(id)) return cols[c].folders[f];
  return null;
}
// Source discovery, quality/seeder/codec classification and per-profile source budget.
/* ================= streams (generic: any addon that declares them) ================= */
function streamAddons(type) {
  return streamAddonsIn(remoteAddons(), type);
}
function qualityLabel(value) {
  return value === 'All'
    ? tx('all')
    : value === 'Other'
      ? tx('other')
      : value === 'Recent'
        ? tx('recent')
        : value;
}
window.__SC_STREAM_COMPAT__ = streamCompatibility;
/* Short tags for the source list, read from the same advisory text: quality, language, what
   stands out in picture and sound (Dolby Vision, HDR, Atmos, DTS:X, IMAX, Remux, 5.1/7.1), size
   and seeders. Other codecs only show when they are a compatibility warning. */
function sourceTags(s) {
  var t = streamText(s),
    low = t.toLowerCase(),
    out = [],
    m;
  if (s.cached) out.push({ t: s.cached === 'debrid' ? tx('cachedTag') : s.cached, c: 'cached' });
  if (s.quality && s.quality !== 'Other' && s.quality !== 'Recent') out.push({ t: s.quality, c: 'q' });
  /* where the release comes from; a camera copy is a warning */
  var origin = /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|\btelesync\b/.test(low)
    ? 'CAM'
    : /\bremux\b/.test(low)
      ? ''
      : /\b(blu[ ._-]?ray|bdrip|brrip)\b/.test(low)
        ? 'BluRay'
        : /\bweb[ ._-]?dl\b/.test(low)
          ? 'WEB-DL'
          : /\bweb[ ._-]?rip\b/.test(low)
            ? 'WEBRip'
            : /\bhdtv\b/.test(low)
              ? 'HDTV'
              : '';
  if (origin) out.push({ t: origin, c: origin === 'CAM' ? 'warn' : 'src' });
  /* what makes a release stand out, as badges of their own */
  if (/(dolby[ ._-]?vision|\bdovi\b|\bdv\b)/.test(low)) out.push({ t: 'DOLBY VISION', c: 'fx' });
  if (/hdr10\+/.test(low)) out.push({ t: 'HDR10+', c: 'fx' });
  else if (/\bhdr(10)?\b/.test(low)) out.push({ t: 'HDR', c: 'fx' });
  if (/\batmos\b/.test(low)) out.push({ t: 'ATMOS', c: 'fx' });
  if (/\bdts[ ._-]?x\b/.test(low)) out.push({ t: 'DTS:X', c: 'fx' });
  if (/\bimax\b/.test(low)) out.push({ t: 'IMAX', c: 'fx' });
  if (/\bremux\b/.test(low)) out.push({ t: 'REMUX', c: 'fx' });
  m = low.match(/(?:^|[^0-9])([57])[ ._]1(?![0-9])/);
  if (m) out.push({ t: m[1] + '.1' });
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(gb|gib|mb|mib)\b/i);
  if (m) out.push({ t: m[1].replace(',', '.') + ' ' + m[2].charAt(0).toUpperCase() + 'B', c: 'size' });
  if (s.seeders >= 0) out.push({ t: tx('seedsTag', s.seeders), c: 'seed' });
  /* the audio and subtitle languages go right after the quality */
  var langTags = [];
  if (s.langs && s.langs.length) langTags.push({ t: langTagText(s.langs), c: 'lang' });
  if (s.subLangs && s.subLangs.length) langTags.push(subTag(s.subLangs));
  var at = 0;
  while (at < out.length && (out[at].c === 'cached' || out[at].c === 'q')) at++;
  Array.prototype.splice.apply(out, [at, 0].concat(langTags));
  return out;
}
window.__SC_SOURCE_TAGS__ = sourceTags;
window.__SC_SOURCE_ITEM__ = sourceItem;
window.__SC_SOURCE_TEXT__ = sourceText;
window.__SC_STREAM_LANGUAGES__ = streamLanguages;
window.__SC_LANGUAGE_INFO__ = streamLanguageInfo;
/* 'PT-BR', 'ES-LA · EN', 'MULTI', or the first two and '+2' when there are more */
function langTagText(langs) {
  var names = [];
  for (var i = 0; i < langs.length; i++)
    names.push(langs[i] === 'es-419' ? 'ES-LA' : langs[i] === 'multi' ? 'MULTI' : langs[i].toUpperCase());
  return names.length > 2 ? names.slice(0, 2).join(' · ') + ' +' + (names.length - 2) : names.join(' · ');
}
/* 'LEG EN · PT +4' (subtitles), without the multi marker the words already imply */
function subTag(langs) {
  var named = [];
  for (var i = 0; i < langs.length; i++) if (langs[i] !== 'multi') named.push(langs[i]);
  return { t: tx('subsTag') + ' ' + (named.length ? langTagText(named) : 'MULTI'), c: 'sublang' };
}
/* filter groups of a source: language bases, 'multi', or 'none' when nothing was detected */
function langGroups(s) {
  var langs = s.langs || [],
    out = [];
  for (var i = 0; i < langs.length; i++) {
    var g = langBase(langs[i]);
    if (out.indexOf(g) < 0) out.push(g);
  }
  if (!out.length) out.push('none');
  return out;
}
/* whether a source passes the language filter of the source list (views/streams.js) */
function inLangFilter(s, key) {
  if (key === 'All') return true;
  var lang = key.slice(2);
  if (key.charAt(0) === 's') return subtitleGroups(s).indexOf(lang) >= 0;
  return langGroups(s).indexOf(lang) >= 0;
}
/* the language groups of a source's subtitles */
function subtitleGroups(s) {
  var out = [],
    subs = s.subLangs || [];
  for (var i = 0; i < subs.length; i++) {
    var g = langBase(subs[i]);
    if (g !== 'multi' && out.indexOf(g) < 0) out.push(g);
  }
  return out;
}
/* a language group by its own name, as in the lists of languages */
function sourceLanguageLabel(code) {
  if (code === 'none') return tx('langOther');
  if (code === 'multi') return 'Multi';
  for (var i = 0; i < SOURCE_LANGUAGES.length; i++)
    if (SOURCE_LANGUAGES[i][0] === code) return SOURCE_LANGUAGES[i][1];
  return { ru: 'Русский', hi: 'हिन्दी', zh: '中文' }[code] || code.toUpperCase();
}
window.__SC_IN_LANG_FILTER__ = inLangFilter;
/* the languages a source can be chosen in, by their own names (Settings, Best source) */
var SOURCE_LANGUAGES = [
  ['pt', 'Português'],
  ['es', 'Español'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['it', 'Italiano'],
  ['de', 'Deutsch'],
  ['ko', '한국어'],
  ['ja', '日本語']
];
function sourceLanguageName(code) {
  for (var i = 0; i < SOURCE_LANGUAGES.length; i++)
    if (SOURCE_LANGUAGES[i][0] === code) return SOURCE_LANGUAGES[i][1];
  return tx('anyLanguage');
}
/* the language the source list is ordered by: only one fixed in Settings, so the one chosen in
   Best source does not reorder the whole list */
function fixedSourceLanguage() {
  var set = lsRaw('preferredSourceLanguage', 'Ask');
  return set === 'Ask' ? 'Auto' : set;
}
/* the language Best source looks for: the one in Settings, or with Ask the last one chosen */
function preferredSourceLanguage() {
  var set = lsRaw('preferredSourceLanguage', 'Ask');
  return set === 'Ask' ? lsRaw('bestLanguage', 'Auto') : set;
}
/* 0 when the source has the preferred audio language, 1 for multi audio, 2 otherwise. A torrent
   with almost no seeders counts as otherwise: the language does not put one that would hardly
   load above the rest. */
var LANGUAGE_MIN_SEEDERS = 5;
function langRank(s, pref) {
  if (!pref || pref === 'Auto') return 0;
  if (s.seeders != null && s.seeders < LANGUAGE_MIN_SEEDERS) return 2;
  var g = langGroups(s);
  return g.indexOf(pref) >= 0 ? 0 : g.indexOf('multi') >= 0 ? 1 : 2;
}
/* What to play without choosing from the list, whose order already puts compatibility and seeders
   first: in the language asked for when there is one, the first without a warning in the quality
   asked for, or else in any known quality, and a low or unknown quality only when nothing better
   has none. A format this TV already failed to play is never picked. */
function bestSource(items, quality, language) {
  var playable = items.filter(function (s) {
    return !s.stored && !(s.compatRank > 0) && !(s.compatLabels || []).length;
  });
  if (!playable.length)
    playable = items.filter(function (s) {
      return !s.stored && s.compatRank < 4 && !(s.unsupported || []).length;
    });
  /* the language asked for first, then multi-audio, keeping the list's order within each */
  if (language && language !== 'Auto')
    playable = playable
      .map(function (s, i) {
        return { s: s, i: i, r: langRank(s, language) };
      })
      .sort(function (a, b) {
        return a.r - b.r || a.i - b.i;
      })
      .map(function (x) {
        return x.s;
      });
  var asked = playable.filter(function (s) {
    return s.quality === quality;
  });
  var known = playable.filter(function (s) {
    return s.quality !== 'Other' && s.quality !== 'SD';
  });
  return asked[0] || healthyBest(playable, language) || known[0] || playable[0] || null;
}
/* With no quality asked for: among the sources that will start well (cached, a direct link, or a
   torrent with enough seeders) in the best language there is, 1080p first (it plays on every TV
   and phone), then 4K, then 720p, each in the list's order. The most seeded 720p used to win over
   a healthy 1080p. */
var HEALTHY_SEEDERS = 10,
  BEST_QUALITIES = ['1080p', '4K', '720p'];
function healthyBest(playable, language) {
  var healthy = playable.filter(function (s) {
    return s.cached || s.seeders == null || s.seeders < 0 || s.seeders >= HEALTHY_SEEDERS;
  });
  if (!healthy.length) return null;
  var rank = function (s) {
    return language && language !== 'Auto' ? langRank(s, language) : 0;
  };
  var best = Math.min.apply(
    null,
    healthy.map(function (s) {
      return rank(s);
    })
  );
  healthy = healthy.filter(function (s) {
    return rank(s) === best;
  });
  for (var q = 0; q < BEST_QUALITIES.length; q++)
    for (var i = 0; i < healthy.length; i++) if (healthy[i].quality === BEST_QUALITIES[q]) return healthy[i];
  return null;
}
window.__SC_BEST_SOURCE__ = bestSource;
/* Best from the title page plays once every addon answered, or this long after the search began
   when a source is already there, so one slow addon does not hold it up */
var BEST_WAIT_MS = 10000;

/* ---- the formats this TV failed to play ----
   The native player says when the TV could not decode a source's audio; the audio formats that
   source named (DTS, TrueHD, E-AC-3) are kept (learnUnsupported), and sources with them go down
   the list with a warning and are never picked by Best. */
function unsupportedFormats() {
  return lsJson('unsupportedFormats') || [];
}
function markUnsupported(item, known) {
  item.unsupported = (item.compatLabels || []).filter(function (l) {
    return known.indexOf(l) >= 0;
  });
  if (item.unsupported.length) item.compatRank = Math.max(item.compatRank || 0, 3);
}
/* the warning line of a source: what this TV failed to play, or what may not play */
function compatText(s) {
  if (s.unsupported && s.unsupported.length) return tx('notOnThisTv', s.unsupported.join(' · '));
  return s.compatLabels && s.compatLabels.length ? tx('compatibilityCheck', s.compatLabels.join(' · ')) : '';
}
/* The addon tabs over the list: All, then each addon with how many sources it has, in name order
   so they do not move as answers arrive; offered when more than one addon has sources. */
function addonChoices(pool) {
  var counts = {},
    names = [];
  for (var n = 0; n < pool.length; n++) {
    if (pool[n].stored) continue;
    var k = pool[n].addon || '';
    if (!counts[k]) names.push(k);
    counts[k] = (counts[k] || 0) + 1;
  }
  if (names.length < 2) return [];
  names.sort(function (a, b) {
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  });
  return [{ key: 'All', label: tx('all') }].concat(
    names.map(function (k) {
      return { key: k, label: (k || 'Addon') + ' ' + counts[k] };
    })
  );
}
function streamSourceKey(s) {
  if (s.stored) return 'stored';
  var u = String(s.url || '').replace(/#.*$/, '');
  var m = u.match(/127\.0\.0\.1:11470\/([0-9a-f]{32,64})\/(\d+)/i);
  return m
    ? 'torrent:' + m[1].toLowerCase() + ':' + m[2]
    : 'url:' + u + '|' + JSON.stringify(s.headers || {}) + '|' + (s.notWebReady ? '1' : '0');
}
function sourceOrder(a, b) {
  if (a.stored && !b.stored) return -1;
  if (b.stored && !a.stored) return 1;
  var ar = a.compatRank || 0,
    br = b.compatRank || 0;
  if (ar !== br) return ar - br;
  if (!a.cached !== !b.cached) return a.cached ? -1 : 1;
  var as = a.seeders == null ? -1 : a.seeders,
    bs = b.seeders == null ? -1 : b.seeders;
  if (as !== bs) return bs - as;
  return (a._seq || 0) - (b._seq || 0);
}
function compactSourcePool(input, cap) {
  var best = {},
    unique = [],
    i,
    s,
    k,
    old,
    buckets = {},
    order = ['Recent', '4K', '1440p', '1080p', '720p', 'SD', 'Other'],
    selected = [],
    kept = {},
    trimmed = {},
    rest = [];
  cap = Math.max(1, cap || 60);
  for (i = 0; i < input.length; i++) {
    s = input[i];
    k = streamSourceKey(s);
    old = best[k];
    if (!old) {
      best[k] = s;
      unique.push(s);
    } else if (sourceOrder(s, old) < 0) {
      for (var u = 0; u < unique.length; u++)
        if (unique[u] === old) {
          unique[u] = s;
          break;
        }
      best[k] = s;
    }
  }
  for (i = 0; i < unique.length; i++) {
    s = unique[i];
    k = s.quality || 'Other';
    if (!buckets[k]) {
      buckets[k] = [];
      if (order.indexOf(k) < 0) order.push(k);
    }
    buckets[k].push(s);
  }
  for (i = 0; i < order.length; i++) {
    k = order[i];
    if (buckets[k]) buckets[k].sort(sourceOrder);
  }
  /* Keep one representative of every available quality, then fill the remaining
     global budget by compatibility and reliable seeder metadata. */
  for (i = 0; i < order.length && selected.length < cap; i++) {
    k = order[i];
    if (buckets[k] && buckets[k].length) {
      selected.push(buckets[k][0]);
      kept[k] = 1;
    }
  }
  for (i = 0; i < order.length; i++) {
    k = order[i];
    if (!buckets[k]) continue;
    for (var r = kept[k] || 0; r < buckets[k].length; r++) rest.push(buckets[k][r]);
  }
  rest.sort(sourceOrder);
  /* One torrent addon with hundreds of results (Torrentio) filled the whole list by seeders, and
     every other addon vanished from it. Each addon keeps a share (half of the list, split evenly
     among all addons) of its best sources; the rest of the list is filled by rank as before. */
  var share = {},
    addons = 0,
    left = [];
  for (i = 0; i < unique.length; i++) {
    k = unique[i].addon || '';
    if (share[k] === undefined) {
      share[k] = 0;
      addons++;
    }
  }
  for (i = 0; i < selected.length; i++)
    share[selected[i].addon || ''] = (share[selected[i].addon || ''] || 0) + 1;
  var floor = Math.floor(cap / (2 * Math.max(1, addons)));
  for (i = 0; i < rest.length; i++) {
    s = rest[i];
    k = s.addon || '';
    if (selected.length < cap && share[k] < floor) {
      share[k]++;
      selected.push(s);
      kept[s.quality || 'Other'] = (kept[s.quality || 'Other'] || 0) + 1;
    } else left.push(s);
  }
  rest = left;
  for (i = 0; i < rest.length && selected.length < cap; i++) {
    s = rest[i];
    selected.push(s);
    k = s.quality || 'Other';
    kept[k] = (kept[k] || 0) + 1;
  }
  for (k in buckets)
    if (Object.prototype.hasOwnProperty.call(buckets, k) && buckets[k].length > (kept[k] || 0))
      trimmed[k] = true;
  return { items: selected, trimmed: trimmed };
}
window.__SC_COMPACT_SOURCES__ = compactSourcePool;
/* onDone(total, failed): failed lists the addons that did not answer, so the picker can
   tell "nothing found" apart from "the addon is down". */
/* the quality chips over the list: All, then each quality with how many sources it has (a +
   when the list was cut) */
/* Quick filters after the quality chips, offered when a source has what they look for: cached
   by a debrid service, HDR or Dolby Vision, Atmos, Remux, and Hide CAM when camera copies came.
   Their keys start with 'f:' and take the quality chip's place in orderedSources. */
var QUICK_FILTERS = [
  [
    'cached',
    'filterCached',
    function (s) {
      return !!s.cached;
    }
  ],
  [
    'hdr',
    'filterHdr',
    function (s) {
      return /(dolby[ ._-]?vision|\bdovi\b|\bdv\b|\bhdr)/i.test(streamText(s));
    }
  ],
  [
    'atmos',
    'filterAtmos',
    function (s) {
      return /\batmos\b/i.test(streamText(s));
    }
  ],
  [
    'remux',
    'filterRemux',
    function (s) {
      return /\bremux\b/i.test(streamText(s));
    }
  ],
  [
    'nocam',
    'filterNoCam',
    function (s) {
      return !isCamCopy(s);
    }
  ]
];
function isCamCopy(s) {
  return /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|\btelesync\b/i.test(streamText(s));
}
function quickFilterTest(key) {
  for (var i = 0; i < QUICK_FILTERS.length; i++)
    if ('f:' + QUICK_FILTERS[i][0] === key) return QUICK_FILTERS[i][2];
  return null;
}
function qualityChips(pool, trimmed) {
  var counts = {},
    out = [],
    order = ['All', '4K', '1440p', '1080p', '720p', 'SD', 'Other'];
  for (var n = 0; n < pool.length; n++) {
    var q = pool[n].quality || 'Other';
    counts[q] = (counts[q] || 0) + 1;
  }
  for (var i = 0; i < order.length; i++) {
    var key = order[i];
    if (key !== 'All' && !counts[key]) continue;
    out.push({
      key: key,
      label:
        qualityLabel(key) +
        (key === 'All' ? '' : ' \u00b7 ' + counts[key] + ((trimmed || {})[key] ? '+' : ''))
    });
  }
  var playable = pool.filter(function (s) {
    return !s.stored;
  });
  for (var f = 0; f < QUICK_FILTERS.length; f++) {
    var test = QUICK_FILTERS[f][2],
      n = playable.filter(test).length;
    /* Hide CAM only when there is a camera copy to hide */
    var offered = QUICK_FILTERS[f][0] === 'nocam' ? n < playable.length && n > 0 : n > 0;
    if (offered)
      out.push({ key: 'f:' + QUICK_FILTERS[f][0], label: tx(QUICK_FILTERS[f][1]) + ' \u00b7 ' + n });
  }
  return out;
}
/* The language filter: 'a:pt' for sources in Portuguese audio, 's:pt' for sources that only
   carry Portuguese subtitles, with how many of each; offered when there is a choice. Audio
   first, then subtitles; within each English, Portuguese, Spanish, the other languages, multi
   audio, then sources with no language. */
function languageChoices(pool) {
  var counts = {},
    order = [];
  function count(key) {
    if (!counts[key]) order.push(key);
    counts[key] = (counts[key] || 0) + 1;
  }
  for (var n = 0; n < pool.length; n++) {
    var s = pool[n];
    if (s.stored) continue;
    var audio = langGroups(s);
    for (var a = 0; a < audio.length; a++) count('a:' + audio[a]);
    var subs = subtitleGroups(s);
    for (var b = 0; b < subs.length; b++) count('s:' + subs[b]);
  }
  var rank = ['en', 'pt', 'es', 'fr', 'it', 'de', 'ja', 'ko', 'zh', 'ru', 'hi', 'multi', 'none'];
  function place(key) {
    return (key.charAt(0) === 's' ? 100 : 0) + rank.indexOf(key.slice(2));
  }
  order.sort(function (x, y) {
    return place(x) - place(y);
  });
  return { keys: order.length > 1 ? ['All'].concat(order) : [], counts: counts };
}
/* 'Audio: Português', 'Subtitles: English', or 'Language: all' */
function langFilterName(key) {
  if (key === 'All') return tx('langChipAll');
  return tx(key.charAt(0) === 's' ? 'subsFilter' : 'langFilter', sourceLanguageLabel(key.slice(2)));
}
/* The list as it is shown: the chosen quality and language, the last source first, then the
   preferred language, then the preferred quality; and the one likely the best choice, named
   only when there is a choice (the same source the Best source button starts), else -1. addon
   keeps one addon's sources ('All' or none: every addon's). */
function orderedSources(pool, quality, langKey, addon) {
  var pref = lsRaw('preferredSourceQuality', 'Auto'),
    langPref = fixedSourceLanguage();
  /* a quick filter chip stands for 'All' qualities with its own test */
  var quick = quickFilterTest(quality);
  if (quick) quality = 'All';
  var flat = pool.filter(function (s) {
    if (s.stored) return quality === 'All' || s.quality === quality;
    if (quick && !quick(s)) return false;
    return (
      (quality === 'All' || s.quality === quality) &&
      inLangFilter(s, langKey) &&
      (!addon || addon === 'All' || s.addon === addon)
    );
  });
  flat.sort(function (a, b) {
    if (!a.stored !== !b.stored) return a.stored ? -1 : 1;
    var al = langRank(a, langPref),
      bl = langRank(b, langPref);
    if (al !== bl) return al - bl;
    if (pref !== 'Auto') {
      var ap = a.quality === pref ? 0 : 1,
        bp = b.quality === pref ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    return sourceOrder(a, b);
  });
  var choices = flat.filter(function (s) {
    return !s.stored;
  }).length;
  return { items: flat, recommended: choices < 2 ? -1 : flat.indexOf(bestSource(flat, pref)) };
}
/* a source's heading and its text, as the list shows them */
function sourceHeading(s) {
  return s.stored ? tx('continuePlayback') : s.addon || 'Addon';
}
/* The release name, as the list shows it: without what the badges already say (Torrentio's
   "👤 120 💾 1.4 GB ⚙️ ThePirateBay" and the lines of flags), so the name is what remains. */
function sourceText(s) {
  var raw = String(s.title || s.name || ''),
    lines = raw.split('\n').map(function (line) {
      return line
        .replace(/(\uD83D\uDC64|\uD83D\uDC65)\s*\d+/g, '')
        .replace(/\uD83D\uDCBE\s*[\d.,]+\s*[KMGT]i?B/gi, '')
        .replace(/\u2699\uFE0F?\s*\S+/g, '')
        .replace(/(\uD83C[\uDDE6-\uDDFF]){2}/g, '')
        .replace(/^[\s|/·-]+|[\s|/·-]+$/g, '');
    });
  var text = lines
    .filter(function (line) {
      return line.length > 0;
    })
    .join('  ');
  return text || raw.replace(/\n/g, '  ');
}
/* onLeft(names), when given, hears which addons are still to answer each time one does */
function fetchStreams(type, vid, onPart, onDone, onLeft) {
  var list = streamAddons(type);
  var pending = list.length;
  var total = 0;
  var failed = [];
  var known = unsupportedFormats();
  var waiting = list.map(function (ad) {
    return ad.name;
  });
  if (!pending) {
    onDone(0, failed);
    return;
  }
  if (onLeft) onLeft(waiting.slice());
  for (var i = 0; i < list.length; i++)
    (function (ad, idx) {
      /* an addon that fails at once (a server error from a busy host, or no answer) is asked once
         more; not one that has no such title, nor one that timed out, which would double the wait */
      function ask(again) {
        xhrJson(
          streamUrl(ad, type, vid),
          function (j, failure, status) {
            if ((failure === 'offline' || status >= 500) && !again)
              return setTimeout(function () {
                ask(true);
              }, 1200);
            if (failure) failed.push(ad.name);
            var st = (j && j.streams) || [];
            var out = [];
            for (var k = 0; k < st.length; k++) {
              var item = sourceItem(st[k], ad.name, ad.base);
              if (!item) continue;
              markUnsupported(item, known);
              out.push(item);
            }
            total += out.length;
            waiting.splice(waiting.indexOf(ad.name), 1);
            if (onLeft) onLeft(waiting.slice());
            if (out.length) onPart(out, idx, ad.name);
            pending--;
            if (pending <= 0) onDone(total, failed);
          },
          45000,
          true
        ); /* slow debrid addons can take 20-30s; phone/PC wait too — 15s was dropping them */
      }
      ask(false);
    })(list[i], i);
}
// Opening the player and remembering source preferences for the next episode.
/* ================= playback ================= */
function playUrl(source, type, id, vid, backHash) {
  var s = typeof source === 'string' ? { url: source } : source;
  if (!s || !s.url) return;
  clientDiag('source_selected', {
    quality: s.quality || '',
    compat: (s.compatLabels || []).join(','),
    seeders: s.seeders == null ? '' : s.seeders
  });
  var tail =
    '&type=' +
    encodeURIComponent(type) +
    '&id=' +
    encodeURIComponent(id) +
    '&vid=' +
    encodeURIComponent(vid) +
    '&back=' +
    encodeURIComponent(backHash) +
    (isLiveType(type) ? '&live=1' : '');
  /* Keep signed cookies/authorization out of browser history and localStorage. The
     Node service stores a small, sanitized stream reference and returns only its id. */
  var body = streamRefBody(s);
  body.meta = s.meta || knownArtwork(type, id);
  function prepare(attempt) {
    postJson(
      '/streamref',
      body,
      function (j) {
        if (j && j.ref) {
          location.assign(appUrl('/play?ref=' + encodeURIComponent(j.ref) + tail));
          return;
        }
        if (attempt < 2) {
          setTimeout(function () {
            prepare(attempt + 1);
          }, 180);
          return;
        }
        clientDiag('streamref_failed', { quality: s.quality || '' });
        toast(tx('sourcePrepareFailed'));
      },
      attempt === 1 ? 2500 : 4500
    );
  }
  /* a torrent needs the engine on this TV, or a streaming server on another computer */
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost):11470\//i.test(s.url))
    xhrJson(
      '/streamfile',
      function (j) {
        if (j && j.state === 'needs-server') toast(tx('torrentsNeedServer'), 6000);
        else if (j && j.state === 'failed') toast(tx('torrentsUnavailable'));
        else if (j && j.state === 'no-room') toast(tx('torrentsNoRoom'), 6000);
        if (!HAS_MEDIA_TOOLS && !(j && j.state === 'needs-server')) prepare(1);
      },
      2000
    );
  if (HAS_MEDIA_TOOLS || !/^https?:\/\/(?:127\.0\.0\.1|localhost):11470\//i.test(s.url)) prepare(1);
}
function resumeSearch(id, vid) {
  var q = null;
  try {
    q = localStorage.getItem('tvstream_' + id + '_' + vid);
  } catch (e) {}
  return q;
}
/* ---------- live channels: watched, never kept (no library, no Continue Watching) ---------- */
function isLiveType(type) {
  return type === 'tv' || type === 'channel';
}
/* the server made the channel a stream reference (app-channels.js play); the page plays it live */
function playLive(ref, backHash) {
  location.assign(
    appUrl('/play?ref=' + encodeURIComponent(ref) + '&live=1&back=' + encodeURIComponent(backHash))
  );
}
/* any channel: an M3U one plays at once; an addon's opens its sources, the only one at once */
function playChannel(ch, backHash) {
  xhrJson(
    '/app/channels/play?key=' +
      encodeURIComponent(ch.key || 'a|' + ch.type + '|' + ch.id) +
      '&name=' +
      encodeURIComponent(ch.name || '') +
      '&logo=' +
      encodeURIComponent(ch.logo || ch.poster || ''),
    function (j) {
      if (j && j.ref) return playLive(j.ref, backHash);
      if (j && j.id) return streamsUI.show(j.type, j.id, j.id, j.name || ch.name, '', '', backHash);
      toast(tx('sourceFailed'));
    },
    20000
  );
}
function playStored(q, backHash) {
  q = q.replace(/&back=[^&]*/, '');
  location.assign(appUrl('/play' + q + '&back=' + encodeURIComponent(backHash)));
}
/* Left by the player when a source would not play (player controls.js): the title page
   reopens the sources and plays the next one, skipping the failed source. */
function retryKey(id, vid) {
  return 'tvretry_' + id + '_' + vid;
}
function hasRetryRequest(id, vid) {
  return !!lsRaw(retryKey(id, vid), '');
}
function takeRetryRequest(id, vid) {
  var pref = lsJson(retryKey(id, vid));
  try {
    localStorage.removeItem(retryKey(id, vid));
  } catch (e) {}
  return pref && pref.at && Date.now() - pref.at < 10 * 60 * 1000 ? pref : null;
}
/* the first source in list order that is not the one that failed */
function nextSourceAfterFailure(items, pref) {
  for (var i = 0; i < items.length; i++) {
    var s = items[i];
    if (s.stored) continue;
    /* the player knows this text after the server took its line breaks out */
    var text = String((s.name || '') + ' ' + (s.title || s.description || ''))
      .replace(/[\r\n\0]/g, ' ')
      .slice(0, 400);
    if (s.addon === pref.addon && text === pref.text) continue;
    return s;
  }
  return null;
}
window.__SC_NEXT_AFTER_FAILURE__ = nextSourceAfterFailure;
function hasNextSourcePreference(id, vid) {
  try {
    return !!localStorage.getItem('tvnextpref_' + id + '_' + vid);
  } catch (e) {
    return false;
  }
}
function takeNextSourcePreference(id, vid) {
  var key = 'tvnextpref_' + id + '_' + vid,
    raw = null,
    pref = null;
  try {
    raw = localStorage.getItem(key);
    localStorage.removeItem(key);
  } catch (e) {}
  if (!raw) return null;
  try {
    pref = JSON.parse(raw);
  } catch (e2) {
    return null;
  }
  if (!pref || !pref.at || Date.now() - pref.at > 10 * 60 * 1000) return null;
  return pref;
}
window.__SC_MATCH_NEXT_SOURCE__ = matchingNextSource;
// Title metadata cache (memory + localStorage) and artwork prewarming.
/* ================= meta (cached; resolves via addons for non-imdb ids) ================= */
var metaMem = {},
  metaMemOrder = [];
function putMetaMem(k, m) {
  var at = metaMemOrder.indexOf(k);
  if (at >= 0) metaMemOrder.splice(at, 1);
  metaMem[k] = m;
  metaMemOrder.push(k);
  while (metaMemOrder.length > (TV_PROFILE.lowMemory ? 12 : 24)) {
    var old = metaMemOrder.shift();
    delete metaMem[old];
  }
}
function metaAddonsFor(type, id) {
  var out = [],
    a = remoteAddons();
  for (var i = 0; i < a.length; i++) {
    var m = a[i] && a[i].manifest;
    if (!m) continue;
    var res = m.resources || [],
      has = false;
    for (var r = 0; r < res.length; r++) {
      var rr = res[r];
      if (rr === 'meta' || (rr && rr.name === 'meta')) has = true;
    }
    if (!has) continue;
    var types = m.types || [];
    if (types.length && types.indexOf(type) < 0) continue;
    var ok = !m.idPrefixes || !m.idPrefixes.length;
    if (m.idPrefixes)
      for (var p = 0; p < m.idPrefixes.length; p++) if (String(id).indexOf(m.idPrefixes[p]) === 0) ok = true;
    if (!ok) {
      for (var r2 = 0; r2 < res.length; r2++) {
        var rr2 = res[r2];
        if (rr2 && rr2.name === 'meta' && rr2.idPrefixes)
          for (var p2 = 0; p2 < rr2.idPrefixes.length; p2++)
            if (String(id).indexOf(rr2.idPrefixes[p2]) === 0) ok = true;
      }
    }
    if (ok) out.push(addonBase(a[i]));
  }
  return out;
}
function capMetaCache(k) {
  var keys = lsJson('beta_meta_keys') || [];
  var i = keys.indexOf(k);
  if (i >= 0) keys.splice(i, 1);
  keys.push(k);
  while (keys.length > 12) {
    var old = keys.shift();
    try {
      localStorage.removeItem('beta_meta_' + old);
    } catch (e) {}
  }
  lsSet('beta_meta_keys', keys);
}
/* What is already known about a title, at once: its name and artwork for the player (playback.js).
   Kitsu anime and long series such as One Piece answer the player's own lookup too late or not
   at all, and the player then had only the torrent's name and no picture. */
function knownArtwork(type, id) {
  var k = type + '_' + id,
    kept = lsJson('beta_meta_' + k),
    m = metaMem[k] || (kept && kept.meta);
  if (!m) return null;
  return { name: m.name || '', logo: m.logo || '', background: m.background || '', poster: m.poster || '' };
}
/* An addon besides Cinemeta that describes IMDb titles, such as TMDB set to Italian: the one the
   viewer installed to read titles in their language. The first in the addon order is used; the
   TMDB addon names only tmdb: ids in its manifest but answers IMDb ones too. */
var LOCAL_META_TIMEOUT_MS = 5000;
function localMetaBase(type, id) {
  var bases = metaAddonsFor(type, id).concat(metaAddonsFor(type, 'tmdb:'));
  for (var i = 0; i < bases.length; i++) if (bases[i] && bases[i].indexOf('cinemeta') < 0) return bases[i];
  return '';
}
/* Cinemeta keeps the structure (ids, episodes, ratings, genres for its own catalogs); the name,
   the synopsis and the episode titles and summaries come from that addon */
function overlayLocalText(meta, local) {
  if (!meta || !local) return;
  if (local.name) meta.name = local.name;
  if (local.description) meta.description = local.description;
  if (!meta.videos || !local.videos) return;
  var byNum = {},
    i,
    v,
    x;
  for (i = 0; i < local.videos.length; i++) {
    x = local.videos[i];
    byNum[x.season + ':' + x.episode] = x;
  }
  for (i = 0; i < meta.videos.length; i++) {
    v = meta.videos[i];
    x = byNum[v.season + ':' + v.episode];
    if (!x) continue;
    if (x.name || x.title) v.name = v.title = x.name || x.title;
    if (x.overview || x.description) v.overview = v.description = x.overview || x.description;
  }
}
window.__SC_OVERLAY_LOCAL__ = overlayLocalText;
function getMeta(type, id, cb) {
  var k = type + '_' + id;
  if (metaMem[k]) {
    cb(metaMem[k]);
    return;
  }
  var ls = lsJson('beta_meta_' + k);
  var fresh = ls && ls.t && Date.now() - ls.t < 43200000 && ls.meta;
  if (fresh) {
    putMetaMem(k, ls.meta);
    cb(ls.meta);
  }
  var bases = isImdb(id) ? [CIN] : metaAddonsFor(type, id);
  if (!bases.length && !fresh) {
    cb(null);
    return;
  }
  /* the text in the viewer's language is asked at the same time, and waited for up to 5 s */
  var local = isImdb(id) ? localMetaBase(type, id) : '',
    localMeta = null,
    localDone = !local,
    whenLocal = null;
  if (local)
    xhrJson(
      local + '/meta/' + type + '/' + encodeURIComponent(id) + '.json' + addonQueryFor(addons(), local),
      function (j) {
        localMeta = j && j.meta;
        localDone = true;
        if (whenLocal) whenLocal();
      },
      LOCAL_META_TIMEOUT_MS
    );
  var bi = 0;
  function tryNext() {
    if (bi >= bases.length) {
      if (!fresh) cb(null);
      return;
    }
    var b = bases[bi++];
    xhrJson(
      b + '/meta/' + type + '/' + encodeURIComponent(id) + '.json' + addonQueryFor(addons(), b),
      function (j) {
        var m = j && j.meta;
        if (!m) {
          tryNext();
          return;
        }
        function keep() {
          whenLocal = null;
          overlayLocalText(m, localMeta);
          putMetaMem(k, m);
          lsSet('beta_meta_' + k, { t: Date.now(), meta: m });
          capMetaCache(k);
          if (!fresh) cb(m);
        }
        if (localDone) keep();
        else whenLocal = keep;
      }
    );
  }
  tryNext();
}
var warmed = {},
  warmedN = 0;
function prewarm(u) {
  if (!u || warmed[u]) return;
  if (warmedN > (TV_PROFILE.lowMemory ? 48 : 140)) {
    warmed = {};
    warmedN = 0;
  } /* keep the book-keeping map tiny */
  warmed[u] = 1;
  warmedN++;
  var im = new Image();
  im.src = u;
}
function prewarmNeighbors(row) {
  if (!row || !row.items) return;
  if (accel.cnt >= 2) return; /* moving at all: no precache — every large texture costs us on this GPU */
  /* warm ONLY the focused item's backdrop + logo (what the hero shows next); neighbours'
     full-screen backdrops were the RAM/GPU hog that made scrolling sluggish. */
  var it = row.items[row.col];
  if (!it) return;
  prewarm(bgMid(it));
  if (!TV_PROFILE.lowMemory && isImdb(it.id)) prewarm(logoOf(it));
}
// Series episode model: season order, continuous numbering and metadata enrichment.
function episodeNumber(v, fallback) {
  var n = parseInt(v && (v.episode != null ? v.episode : v.number), 10);
  return n > 0 ? n : fallback;
}
function explicitAbsoluteEpisode(v) {
  var keys = ['absoluteEpisode', 'absolute_episode', 'absoluteNumber', 'absolute_number', 'episodeAbsolute'];
  for (var i = 0; i < keys.length; i++) {
    var n = parseInt(v && v[keys[i]], 10);
    if (n > 0) return n;
  }
  return 0;
}
function releasedTime(v) {
  var t = Date.parse((v && (v.released || v.firstAired)) || '');
  return isNaN(t) ? 0 : t;
}
/* an episode without a date counts as released: addons often omit it */
function episodeReleased(v, now) {
  var t = releasedTime(v);
  return !t || t <= (now || Date.now());
}
/* Episodes sort by number. Chromium 38/53 sort is not stable beyond 10 items, so ties
   (missing or repeated numbers) fall back to the release date and then to the order
   the addon sent, which keeps the list and the overall numbering identical on every
   opening. Unnumbered episodes go after the numbered ones of their season. */
function episodeOrder(a, b) {
  var na = episodeNumber(a, 0),
    nb = episodeNumber(b, 0);
  if (na && nb && na !== nb) return na - nb;
  if (!na !== !nb) return na ? -1 : 1;
  var ra = releasedTime(a),
    rb = releasedTime(b);
  if (ra && rb && ra !== rb) return ra - rb;
  return a._stremOrder - b._stremOrder;
}
function buildEpisodeModel(videos) {
  var bySeason = {},
    order = [],
    seen = {},
    hasSeasons = false,
    i,
    s,
    v,
    eps,
    o,
    sn,
    last,
    cursor = 0,
    seasons = [],
    linear = [];
  videos = videos || [];
  for (i = 0; i < videos.length; i++) if (videos[i] && videos[i].season != null) hasSeasons = true;
  for (i = 0; i < videos.length; i++) {
    v = videos[i];
    if (!v || (v.id && seen[v.id])) continue; /* an addon listing the same video twice */
    if (v.id) seen[v.id] = 1;
    v._stremOrder = i;
    /* without any season field (channel-like series) the videos are one regular
       season, not specials, so they still get an overall numbering */
    s = v.season != null ? parseInt(v.season, 10) : hasSeasons ? 0 : 1;
    if (isNaN(s)) s = 0;
    if (!bySeason[s]) {
      bySeason[s] = [];
      order.push(s);
    }
    bySeason[s].push(v);
  }
  order.sort(function (a, b) {
    if (a === 0) return 1;
    if (b === 0) return -1;
    return a - b;
  });
  for (o = 0; o < order.length; o++) {
    sn = order[o];
    eps = bySeason[sn];
    eps.sort(episodeOrder);
    last = 0;
    for (i = 0; i < eps.length; i++) {
      v = eps[i];
      v._stremSeason = sn;
      /* an unnumbered episode continues after the highest number seen, never reusing one */
      v._stremSeasonEpisode = episodeNumber(v, last + 1);
      last = Math.max(last, v._stremSeasonEpisode);
      if (sn === 0) v._stremAbsolute = 0;
      else {
        var ex = explicitAbsoluteEpisode(v);
        cursor = ex > 0 ? Math.max(cursor + 1, ex) : cursor + 1;
        v._stremAbsolute = cursor;
        linear.push(v);
      }
    }
    seasons.push({ n: sn, eps: eps });
  }
  return { seasons: seasons, linear: linear };
}
/* Episodes watched on any Stremio app, from the library item's `watched` field decoded by
   the local server (/watchedbits). Same rule as stremio-watched-bitfield: video ids ordered
   by season then episode (season 0 first, ties keep the addon order), and the stored bits
   shifted so that the anchor video keeps its position. An unknown anchor means none. */
function watchedFromBits(res, videos) {
  var list = [],
    out = {},
    i;
  for (i = 0; i < (videos || []).length; i++)
    if (videos[i] && videos[i].id) list.push({ v: videos[i], i: i });
  function num(x) {
    var n = parseInt(x, 10);
    return isNaN(n) ? -Infinity : n;
  }
  list.sort(function (a, b) {
    var sa = num(a.v.season),
      sb = num(b.v.season),
      ea = num(a.v.episode != null ? a.v.episode : a.v.number),
      eb = num(b.v.episode != null ? b.v.episode : b.v.number);
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (ea !== eb) return ea < eb ? -1 : 1;
    return a.i - b.i;
  });
  var at = -1;
  for (i = 0; i < list.length; i++) if (list[i].v.id === res.anchor) at = i;
  if (at < 0 || !res.bits) return out;
  var offset = (parseInt(res.alen, 10) || 0) - at - 1;
  for (i = 0; i < list.length; i++) {
    var j = i + offset;
    if (j >= 0 && j < res.bits.length && res.bits[j]) out[list[i].v.id] = 1;
  }
  return out;
}
window.__SC_WATCHED_FROM_BITS__ = watchedFromBits;
function episodeImage(v, meta) {
  var u = (v && (v.thumbnail || v.still || v.stillPath || v.still_path)) || '';
  if (u && String(u).charAt(0) === '/') u = 'https://image.tmdb.org/t/p/w500' + u;
  return u;
}
function episodeIndexByNumber(items, n) {
  for (var i = 0; i < (items || []).length; i++) if (items[i]._stremAbsolute === n) return i;
  return -1;
}
window.__SC_EPISODE_INDEX__ = episodeIndexByNumber;
function episodeFallback(meta, small) {
  if (!meta) return '';
  return small ? bgSmall(meta) || posterOf(meta) : meta.background || bgOf(meta) || meta.poster || '';
}
function mergeEpisodeDetails(base, extra) {
  if (!base || !extra || !base.videos || !extra.videos) return false;
  var byId = {},
    byNum = {},
    i,
    v,
    x,
    k,
    changed = false,
    fields = [
      'thumbnail',
      'still',
      'stillPath',
      'still_path',
      'overview',
      'description',
      'name',
      'title',
      'absoluteEpisode',
      'absolute_episode',
      'absoluteNumber',
      'absolute_number'
    ];
  for (i = 0; i < extra.videos.length; i++) {
    x = extra.videos[i];
    if (x.id) byId[x.id] = x;
    k = String(x.season == null ? 0 : x.season) + ':' + String(episodeNumber(x, i + 1));
    byNum[k] = x;
  }
  for (i = 0; i < base.videos.length; i++) {
    v = base.videos[i];
    x =
      (v.id && byId[v.id]) ||
      byNum[String(v.season == null ? 0 : v.season) + ':' + String(episodeNumber(v, i + 1))];
    if (!x) continue;
    for (var f = 0; f < fields.length; f++) {
      k = fields[f];
      if (!v[k] && x[k]) {
        v[k] = x[k];
        changed = true;
      }
    }
  }
  return changed;
}
function enrichEpisodeMetadata(type, id, meta, cb) {
  if (type !== 'series' || !meta || !meta.videos || !meta.videos.length) {
    cb(false);
    return;
  }
  var bases = metaAddonsFor(type, id),
    seen = {},
    queue = [];
  for (var i = 0; i < bases.length; i++) {
    var b = bases[i];
    if (b && b !== CIN && !seen[b]) {
      seen[b] = 1;
      queue.push(b);
    }
  }
  var at = 0,
    changed = false;
  function next() {
    if (at >= queue.length) {
      cb(changed);
      return;
    }
    var b = queue[at++];
    xhrJson(
      b + '/meta/' + type + '/' + encodeURIComponent(id) + '.json' + addonQueryFor(addons(), b),
      function (j) {
        if (j && j.meta) changed = mergeEpisodeDetails(meta, j.meta) || changed;
        next();
      },
      4500
    );
  }
  next();
}
window.__SC_EPISODE_MODEL__ = buildEpisodeModel;
window.__SC_MERGE_EPISODES__ = mergeEpisodeDetails;
// Series that gained episodes since they were last watched, for the Home row.
/* Checked at most once a day, for the few series watched most recently, one metadata
   request at a time in the background after Home is up. The result is stored and shown
   the next time Home is built, so a row never appears under the viewer's focus. */
var NEW_EPISODES_KEY = 'newEpisodes',
  NEW_EPISODES_HIDDEN = 'newEpisodesHidden',
  NEW_EPISODES_EVERY = 24 * 60 * 60 * 1000;
/* the series the viewer took out of the row (card menu) */
function hiddenNewEpisodes() {
  return lsJson(NEW_EPISODES_HIDDEN) || [];
}
/* Settings: the new episodes dismissed from Home come back */
function showHiddenNewEpisodes() {
  lsSet(NEW_EPISODES_HIDDEN, []);
}
function newEpisodeItems() {
  var c = lsJson(NEW_EPISODES_KEY),
    hidden = hiddenNewEpisodes();
  return ((c && c.items) || []).filter(function (it) {
    return hidden.indexOf(it.id) < 0;
  });
}
function hideNewEpisodes(id) {
  var hidden = hiddenNewEpisodes();
  if (hidden.indexOf(id) < 0) hidden.push(id);
  lsSet(NEW_EPISODES_HIDDEN, hidden);
}
/* the first aired, unwatched regular episode released after the series was last watched */
function firstNewEpisode(meta, state) {
  var since = Date.parse(state.lastWatched || '') || 0,
    now = Date.now(),
    seen = {},
    best = null,
    bestAt = 0,
    count = 0,
    we = state.watchedEpisodes || [];
  for (var w = 0; w < we.length; w++) seen[we[w]] = 1;
  var videos = (meta && meta.videos) || [];
  for (var i = 0; i < videos.length; i++) {
    var v = videos[i],
      at = releasedTime(v);
    if (!v || !v.id || !(parseInt(v.season, 10) > 0) || seen[v.id]) continue;
    if (!at || at <= since || at > now) continue;
    count++;
    if (!best || at < bestAt) {
      best = v;
      bestAt = at;
    }
  }
  return best ? { id: best.id, count: count } : null;
}
window.__SC_FIRST_NEW_EPISODE__ = firstNewEpisode;
/* the series this TV follows: in the library, or watched even after leaving it */
function followedSeries() {
  var lib = allLib(),
    out = [];
  for (var i = 0; i < lib.length; i++) {
    var it = lib[i],
      s = it.state || {};
    if (it.type !== 'series' || !it._id) continue;
    if (it.removed && !(s.timeOffset > 0) && !(s.watchedEpisodes && s.watchedEpisodes.length)) continue;
    out.push(it);
  }
  return out.sort(function (a, b) {
    return String(b._mtime || '').localeCompare(String(a._mtime || ''));
  });
}
function checkNewEpisodes(done) {
  var cached = lsJson(NEW_EPISODES_KEY);
  if (cached && cached.at && Date.now() - cached.at < NEW_EPISODES_EVERY) {
    done(false);
    return;
  }
  var series = followedSeries()
    .filter(function (it) {
      return hiddenNewEpisodes().indexOf(it._id) < 0;
    })
    .slice(0, TV_PROFILE.lowMemory ? 3 : 6);
  var found = [],
    at = 0;
  function next() {
    if (at >= series.length) {
      var before = JSON.stringify(newEpisodeItems());
      lsSet(NEW_EPISODES_KEY, { at: Date.now(), items: found });
      done(JSON.stringify(found) !== before);
      return;
    }
    var it = series[at++];
    getMeta('series', it._id, function (m) {
      var ep = m && firstNewEpisode(m, it.state || {});
      if (ep)
        found.push({
          id: it._id,
          type: 'series',
          name: (m && m.name) || it.name || '',
          poster: it.poster || (m && m.poster) || '',
          background: it.background || (m && m.background) || '',
          videoId: ep.id,
          fresh: true
        });
      next();
    });
  }
  next();
}
// The calendar, for both interfaces (the server lays it out: app-api.js calendar).
/* The calendar (as Nuvio's): episodes of the followed series from a week ago to two months ahead,
   by air date. done(items) with each item's series, episode and when it airs. */
var CALENDAR_SERIES = 30,
  CALENDAR_BEFORE = 7 * 86400000,
  CALENDAR_AFTER = 60 * 86400000,
  CALENDAR_AT_ONCE = 4,
  CALENDAR_KEEP_MS = 6 * 3600 * 1000,
  CALENDAR_KEY = 'beta_calendar',
  /* kept in storage too, so a restart of the interface (a new language) keeps the Upcoming row */
  calendarKept = lsJson(CALENDAR_KEY);
/* the series are asked four at a time, and the answer kept six hours */
/* The next episode still to air of each followed series, soonest first, from the calendar kept
   (Home's Upcoming row; calendarEpisodes fills it at start) */
var UPCOMING_MAX = 20;
function upcomingItems() {
  var now = Date.now(),
    seen = {},
    out = [];
  var items = (calendarKept && calendarKept.items) || [];
  for (var i = 0; i < items.length && out.length < UPCOMING_MAX; i++) {
    var it = items[i];
    if (it.released <= now || seen[it.id]) continue;
    seen[it.id] = 1;
    out.push({
      id: it.id,
      type: 'series',
      name: it.name,
      poster: it.poster,
      background: it.background,
      videoId: it.videoId,
      airsAt: it.released
    });
  }
  return out;
}
function calendarEpisodes(done) {
  if (calendarKept && Date.now() - calendarKept.at < CALENDAR_KEEP_MS) return done(calendarKept.items);
  var series = followedSeries().slice(0, CALENDAR_SERIES),
    now = Date.now(),
    out = [],
    next = 0,
    left = series.length;
  if (!left) return done(out);
  function ask() {
    if (next >= series.length) return;
    var it = series[next++];
    getMeta('series', it._id, function (m) {
      var videos = (m && m.videos) || [];
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i],
          at = releasedTime(v);
        if (!at || at < now - CALENDAR_BEFORE || at > now + CALENDAR_AFTER) continue;
        out.push({
          id: it._id,
          type: 'series',
          name: (m && m.name) || it.name || '',
          poster: it.poster || (m && m.poster) || '',
          background: it.background || (m && m.background) || '',
          videoId: v.id,
          season: v.season,
          episode: v.episode,
          title: v.name || v.title || '',
          released: at
        });
      }
      ask();
      if (--left) return;
      out.sort(function (a, b) {
        return a.released - b.released;
      });
      calendarKept = { at: Date.now(), items: out };
      lsSet(CALENDAR_KEY, calendarKept);
      done(out);
    });
  }
  for (var n = 0; n < CALENDAR_AT_ONCE; n++) ask();
}
// Library add/remove and watched state.
/* ================= library helpers (explicit add only — watching never adds) ================= */
function libHas(id) {
  var it = lsJson(PRE + id);
  return !!(it && it.removed === false);
}
/* A film counts as watched when Stremio says so (times watched or the watched flag, also
   set by other devices, which reset the position to 0 once a film ends), when it is in the
   local watched list, or when it stopped in the credits (past 90 %). */
function itemWatched(it) {
  if (!it || !it.id || it.type === 'series') return false;
  var lib = lsJson(PRE + it.id);
  if (!lib || !lib.state) return false;
  var s = lib.state;
  var vid = it.videoId || it.id;
  if (s.timesWatched > 0 || s.flaggedWatched > 0) return true;
  if (s.watchedEpisodes)
    for (var i = 0; i < s.watchedEpisodes.length; i++) if (s.watchedEpisodes[i] === vid) return true;
  return watchFinished(s.timeOffset, s.duration);
}
/* A library entry as Stremio stores one, for a title the library has not seen yet */
function newLibItem(item, now) {
  return {
    state: {
      lastWatched: now,
      timeOffset: 0,
      timeWatched: 0,
      overallTimeWatched: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      duration: 0,
      video_id: item.id,
      watched: '',
      noNotif: false,
      season: 0,
      episode: 0,
      watchedEpisodes: []
    },
    _id: item.id,
    _ctime: now
  };
}
/* Channels that 4.3.0 and earlier kept after playing them live: out of the library and Continue
   Watching, on this TV and on the account, once */
function dropLiveFromLibrary() {
  if (lsRaw('liveDropped', '')) return;
  lsRawSet('liveDropped', '1');
  var gone = [],
    now = new Date().toISOString(),
    lib = allLib();
  for (var i = 0; i < lib.length; i++) {
    var it = lib[i];
    if (!isLiveType(it.type) || (it.removed && !it.temp)) continue;
    it.removed = true;
    it.temp = false;
    it._mtime = now;
    lsSet(PRE + it._id, it);
    gone.push(it);
  }
  if (gone.length) pushLibItems(gone);
}
function libToggle(item) {
  var now = new Date().toISOString();
  var it = lsJson(PRE + item.id);
  if (it && it.removed === false) {
    it.removed = true;
    it._mtime = now;
    lsSet(PRE + item.id, it);
    toast(tx('removedLibrary'));
  } else {
    if (!it) it = newLibItem(item, now);
    it.removed = false;
    it.temp = false;
    it._mtime = now;
    it.name = item.name || it.name || '';
    it.type = item.type;
    it.poster = item.poster || it.poster || '';
    it.posterShape = 'poster';
    it.background = item.background || it.background || '';
    lsSet(PRE + item.id, it);
    toast(tx('addedLibrary'));
  }
  pushLib(lsJson(PRE + item.id));
  invalidateBoards();
}
/* Leaves Continue Watching without marking anything watched, as Stremio dismisses an
   item: the saved position returns to the start. Synced like any library change. */
function dismissCw(id) {
  var lib = lsJson(PRE + id);
  if (!lib || !lib.state) return null;
  lib.state.timeOffset = 0;
  lib._mtime = new Date().toISOString();
  lsSet(PRE + id, lib);
  return lib;
}
function removeFromCw(it) {
  var lib = dismissCw(it.id);
  if (lib) pushLib(lib);
  invalidateBoards();
}
function clearContinueWatching() {
  var items = cwItems(1000),
    changed = [];
  for (var i = 0; i < items.length; i++) {
    var lib = dismissCw(items[i]._id);
    if (lib) changed.push(lib);
  }
  pushLibItems(changed);
  invalidateBoards();
  return changed.length;
}
/* The searches Search offers again: typing with the remote is slow, so the last ones stay
   one key away (views/search.js). */
var RECENT_SEARCH_KEY = 'recentSearches',
  RECENT_SEARCH_MAX = 8;
function recentSearches() {
  var list = lsJson(RECENT_SEARCH_KEY);
  return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
}
function rememberSearch(q) {
  q = String(q || '').replace(/^\s+|\s+$/g, '');
  if (!q || lsRaw('noHistory', 'false') === 'true') return;
  var list = recentSearches(),
    out = [q];
  for (var i = 0; i < list.length && out.length < RECENT_SEARCH_MAX; i++)
    if (typeof list[i] === 'string' && list[i].toLowerCase() !== q.toLowerCase()) out.push(list[i]);
  lsSet(RECENT_SEARCH_KEY, out);
}
function clearRecentSearches() {
  lsSet(RECENT_SEARCH_KEY, []);
  search.recentSig = null;
}
/* Marked watched as the official apps do: the watched flag, one more time watched and,
   for an episode, its bit in state.watched (written by the local server, which has the
   episode list), so other devices show it too. */
function markCwWatched(it) {
  var lib2 = lsJson(PRE + it.id);
  if (!lib2) return;
  var s2 = lib2.state || {};
  var vid = s2.video_id || it.videoId || it.id;
  if (!s2.watchedEpisodes) s2.watchedEpisodes = [];
  if (s2.watchedEpisodes.indexOf(vid) < 0) s2.watchedEpisodes.push(vid);
  if (!s2.flaggedWatched) s2.timesWatched = (s2.timesWatched || 0) + 1;
  s2.flaggedWatched = 1;
  s2.timeOffset = 0;
  lib2.state = s2;
  lib2._mtime = new Date().toISOString();
  lsSet(PRE + it.id, lib2);
  pushLib(lib2);
  invalidateBoards();
  if (lib2.type !== 'series' || vid === it.id) return;
  pushEpisodeField(it.id, vid, true, s2.watched);
}
/* An episode's bit in state.watched, written by the local server (it has the episode
   list), so other devices show the change too; cb runs once it is saved. */
function pushEpisodeField(id, vid, watched, field, cb) {
  xhrJson(
    '/watchedset?id=' +
      encodeURIComponent(id) +
      '&vid=' +
      encodeURIComponent(vid) +
      '&w=' +
      (watched ? '1' : '0') +
      '&f=' +
      encodeURIComponent(field || ''),
    function (j) {
      var cur = lsJson(PRE + id);
      if (j && j.watched && cur && cur.state) {
        cur.state.watched = j.watched;
        cur._mtime = new Date().toISOString();
        lsSet(PRE + id, cur);
        pushLib(cur);
      }
      if (cb) cb();
    }
  );
}
/* Mark as watched / unwatched from the title menu: a film (it.videoId empty or its own id)
   or one episode of a series (it.videoId). A title not in the library gets an entry that
   stays out of it (removed), as Stremio keeps watched state for titles never added. */
function setItemWatched(it, watched, cb) {
  var now = new Date().toISOString(),
    lib = lsJson(PRE + it.id);
  if (!lib) {
    lib = newLibItem(it, now);
    lib.removed = true;
    lib.temp = true;
    lib.name = it.name || '';
    lib.type = it.type;
    lib.poster = it.poster || '';
    lib.posterShape = 'poster';
    lib.background = it.background || '';
  }
  var s = lib.state || (lib.state = {}),
    vid = it.videoId || it.id,
    episode = it.type === 'series' && vid !== it.id;
  if (!s.watchedEpisodes) s.watchedEpisodes = [];
  var at = s.watchedEpisodes.indexOf(vid);
  if (watched && at < 0) s.watchedEpisodes.push(vid);
  if (!watched && at >= 0) s.watchedEpisodes.splice(at, 1);
  if (!episode) {
    if (watched && !s.flaggedWatched) s.timesWatched = (s.timesWatched || 0) + 1;
    s.flaggedWatched = watched ? 1 : 0;
    if (!watched) s.timesWatched = 0;
  }
  if (s.video_id === vid) s.timeOffset = 0;
  lib._mtime = now;
  lsSet(PRE + it.id, lib);
  pushLib(lib);
  invalidateBoards();
  if (episode) pushEpisodeField(it.id, vid, watched, s.watched, cb);
  else if (cb) cb();
}
/* A whole season at once: its episodes one after another, since each episode's bit is
   written over the field the previous one left. */
/* The regular episodes of a series in order up to vid, vid included (marking one watched marks the
   ones before it too, as the official apps' "watched up to here"); all of them when vid is empty.
   A special (season 0) is only itself. */
function episodesUpTo(meta, vid) {
  var seasons = buildEpisodeModel((meta && meta.videos) || []).seasons,
    out = [];
  for (var s = 0; s < seasons.length; s++) {
    if (!(seasons[s].n > 0)) continue;
    for (var e = 0; e < seasons[s].eps.length; e++) {
      out.push(seasons[s].eps[e].id);
      if (vid && seasons[s].eps[e].id === vid) return out;
    }
  }
  return vid ? [vid] : out;
}
function setEpisodesWatched(it, vids, watched, cb) {
  var i = 0;
  (function next() {
    if (i >= vids.length) {
      if (cb) cb();
      return;
    }
    setItemWatched(
      {
        type: 'series',
        id: it.id,
        name: it.name,
        poster: it.poster,
        background: it.background,
        videoId: vids[i++]
      },
      watched,
      next
    );
  })();
}
// What the title screen says, apart from how it is drawn: the facts line, the first action and
// the episode to land on, and each episode's line and badge. Shared with the native interface.
/* The title's details on one line: who directed it (when the line above names the cast), the
   country and the release date, as Cinemeta gives them. */
function titleFacts(m, castShown) {
  var parts = [];
  if (castShown && m.director && m.director.length)
    parts.push(tx('directedBy', m.director.slice(0, 2).join(', ')));
  if (m.country) parts.push(String(m.country).split(',')[0]);
  var released = m.released ? new Date(m.released) : null;
  if (released && !isNaN(released.getTime()))
    try {
      parts.push(released.toLocaleDateString(UI_LANG, { day: 'numeric', month: 'short', year: 'numeric' }));
    } catch (e) {
      parts.push(String(released.getFullYear()));
    }
  return parts.join('  ·  ');
}
/* saved progress worth offering, in the Continue Watching card shape (account.js) */
function resumeInfoFor(id) {
  var lib = lsJson(PRE + id),
    s = lib && lib.state;
  if (!s) return null;
  var c = cwCard(lib);
  if (c.upNext) return c;
  if (!(s.timeOffset > 60000) || watchFinished(s.timeOffset, s.duration)) return null;
  return c;
}
function resumeLabel(c) {
  var pp = String(c.videoId || '').split(':'),
    ep = pp.length >= 3 ? [pp[pp.length - 2], pp[pp.length - 1]] : null;
  if (c.upNext) return ep ? tx('playEpisode', ep[0], ep[1]) : tx('watch');
  var left = c.minutesLeft ? '  ·  ' + tx('cwLeft', c.minutesLeft) : '';
  return (ep ? tx('continueEpisode', ep[0], ep[1]) : tx('continueLabel')) + left;
}
/* the first released episode not watched yet; once everything released was watched,
   the latest released one (not S1E1, and never an episode that has not aired) */
function firstUnwatched(seasons, watchedMap) {
  var now = Date.now(),
    latest = null;
  for (var s = 0; s < seasons.length; s++) {
    if (seasons[s].n === 0) continue;
    var eps = seasons[s].eps;
    for (var e = 0; e < eps.length; e++) {
      if (!episodeReleased(eps[e], now)) continue;
      if (!watchedMap[eps[e].id]) return eps[e].id;
      latest = eps[e].id;
    }
  }
  if (latest) return latest;
  return seasons[0] && seasons[0].eps[0] ? seasons[0].eps[0].id : null;
}
/* Settings > Spoilers: what of an episode not watched yet stays hidden: nothing ('off'), its
   picture ('pictures'), or its picture and synopsis ('all') */
function spoilerMode() {
  return lsRaw('spoilers', 'off');
}
/* an air date in the viewer's language, "10 Mar 2008" */
function episodeDay(at) {
  try {
    return new Date(at).toLocaleDateString(UI_LANG, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return new Date(at).toISOString().slice(0, 10);
  }
}
/* the focused episode: numbering, air date, length and whether it has aired yet */
function episodeMetaLine(cv) {
  var bits = [
      cv._stremAbsolute
        ? tx('seasonAbsoluteEpisode', cv._stremSeason, cv._stremSeasonEpisode, cv._stremAbsolute)
        : tx('seasonEpisode', cv._stremSeason, cv._stremSeasonEpisode)
    ],
    at = releasedTime(cv);
  if (at) bits.push(episodeDay(at));
  if (cv.runtime) bits.push(cv.runtime);
  if (at > Date.now()) bits.push(tx('badgeSoon'));
  return bits.join('  ·  ');
}
/* Coming soon before release, New during the first week */
function episodeBadge(v, now) {
  var at = releasedTime(v);
  if (!at) return '';
  if (at > now) return tx('badgeSoon');
  return now - at < 7 * 86400000 ? tx('badgeNew') : '';
}
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
      k: 'skipIntro',
      lb: tx('skipIntroSetting'),
      opts: [
        ['button', tx('skipOnOk')],
        ['auto', tx('skipByItself')],
        ['off', tx('disabled')]
      ],
      d: 'button'
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
      k: 'forcedSubs',
      lb: tx('forcedSubsSetting'),
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
      k: 'screensaver',
      lb: tx('screensaverSetting'),
      opts: [
        ['0', tx('disabled')],
        ['5', tx('minutesN', 5)],
        ['10', tx('minutesN', 10)],
        ['20', tx('minutesN', 20)]
      ],
      d: '5'
    },
    {
      k: 'spoilers',
      lb: tx('spoilersSetting'),
      opts: [
        ['off', tx('spoilersShow')],
        ['pictures', tx('spoilersPictures')],
        ['all', tx('spoilersAll')]
      ],
      d: 'off'
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
    {
      k: 'discoverMax',
      lb: tx('discoverMaxLabel'),
      opts: [
        ['80', tx('discoverMax80')],
        ['200', tx('discoverMax200')],
        ['500', tx('discoverMax500')]
      ],
      d: String(discoverMax())
    },
    {
      k: 'pointer',
      lb: tx('pointerLabel'),
      opts: [
        ['on', tx('enabled')],
        ['off', tx('disabled')]
      ],
      d: 'on'
    },
    { k: '__rows', lb: tx('organizeCatalogs'), action: true },
    { head: tx('navChannels'), id: 'channels' },
    { k: '__m3u', lb: tx('m3uAdd'), action: true },
    { k: '__m3uLists', lb: tx('m3uManage'), action: true },
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
/* ---------- what only the native server uses (the web interface has its own ways) ---------- */
/* the source Best plays from a whole search, in the quality and language preferred in Settings */
function bestOf(pool) {
  return bestSource(
    orderedSources(pool, 'All', 'All').items,
    lsRaw('preferredSourceQuality', 'Auto'),
    preferredSourceLanguage()
  );
}
/* labels: the compatibility labels of the source that failed; returns the formats newly kept */
var AUDIO_FORMATS = ['TrueHD', 'DTS', 'E-AC-3'];
function learnUnsupported(labels, what) {
  var known = unsupportedFormats(),
    added = (labels || []).filter(function (l) {
      return what === 'audio' && AUDIO_FORMATS.indexOf(l) >= 0 && known.indexOf(l) < 0;
    });
  if (added.length) lsSet('unsupportedFormats', known.concat(added));
  return added;
}

/* what the server may call (server/app-api.js); nothing else is reachable from outside */
window.__logic = {
  addonChoices: addonChoices,
  addons: addons,
  addonsFor: addonsFor,
  BEST_WAIT_MS: BEST_WAIT_MS,
  allLib: allLib,
  authKey: authKey,
  bestOf: bestOf,
  bestSource: bestSource,
  bgOf: bgOf,
  bgSmall: bgSmall,
  buildEpisodeModel: buildEpisodeModel,
  calendarEpisodes: calendarEpisodes,
  checkNewEpisodes: checkNewEpisodes,
  clearContinueWatching: clearContinueWatching,
  clearRecentSearches: clearRecentSearches,
  compactSourcePool: compactSourcePool,
  compatText: compatText,
  completeSignIn: completeSignIn,
  cwItems: cwItems,
  cwCard: cwCard,
  cwSubtitle: cwSubtitle,
  defaultMediaLanguage: defaultMediaLanguage,
  diagEventLine: diagEventLine,
  diagStreamingState: diagStreamingState,
  discoverCatalogs: discoverCatalogs,
  discoverGenres: discoverGenres,
  discoverPageUrl: discoverPageUrl,
  discoverTypes: discoverTypes,
  enrichEpisodeMetadata: enrichEpisodeMetadata,
  episodesUpTo: episodesUpTo,
  episodeBadge: episodeBadge,
  episodeDay: episodeDay,
  episodeFallback: episodeFallback,
  episodeImage: episodeImage,
  episodeMetaLine: episodeMetaLine,
  firstUnwatched: firstUnwatched,
  fetchStreams: fetchStreams,
  getCatalogUrl: getCatalogUrl,
  getMeta: getMeta,
  hiddenNewEpisodes: hiddenNewEpisodes,
  hideNewEpisodes: hideNewEpisodes,
  homeDefs: homeDefs,
  homeLibraryRows: homeLibraryRows,
  homeRowChoices: homeRowChoices,
  folderView: folderView,
  folderSources: folderSources,
  discoverMax: discoverMax,
  findFolder: findFolder,
  dropLiveFromLibrary: dropLiveFromLibrary,
  saveHomeLayout: saveHomeLayout,
  isNuvioAccount: isNuvioAccount,
  isSwitch: isSwitch,
  knownArtwork: knownArtwork,
  langFilterName: langFilterName,
  spoilerMode: spoilerMode,
  screensaverItems: screensaverItems,
  screensaverMinutes: screensaverMinutes,
  learnUnsupported: learnUnsupported,
  languageChoices: languageChoices,
  itemWatched: itemWatched,
  libGridItems: libGridItems,
  libHas: libHas,
  libKey: function (id) {
    return PRE + id;
  },
  libItem: function (id) {
    return lsJson(PRE + id);
  },
  libToggle: libToggle,
  /* the last toast the data code said, then forgotten */
  takeMessage: function () {
    var m = lastMessage;
    lastMessage = '';
    return m;
  },
  markCwWatched: markCwWatched,
  matchingNextSource: matchingNextSource,
  newEpisodeItems: newEpisodeItems,
  nuvioCollections: nuvioCollections,
  orderedSources: orderedSources,
  posterOf: posterOf,
  logoOf: logoOf,
  pullLib: pullLib,
  pruneCaches: pruneCaches,
  pushLib: pushLib,
  qualityChips: qualityChips,
  /* after another profile was chosen: its user, addons and collections */
  reloadAccount: function (done) {
    postJson(API + '/api/getUser', { authKey: authKey() }, function (u) {
      if (u && u.result) lsSet('user', u.result);
      lsRawSet('addons', '');
      syncAddons(function () {
        syncCollections(function () {
          done();
        });
      });
    });
  },
  recentSearches: recentSearches,
  releasedTime: releasedTime,
  rememberSearch: rememberSearch,
  resumeInfoFor: resumeInfoFor,
  resumeLabel: resumeLabel,
  setting: lsRaw,
  settingValueLabel: settingValueLabel,
  settingsCategories: settingsCategories,
  showHiddenNewEpisodes: showHiddenNewEpisodes,
  signOut: signOut,
  storeSetting: storeSetting,
  signInRequest: function (body, cb) {
    postJson(API + '/api/login', body, cb);
  },
  simpleMode: simpleMode,
  removeFromCw: removeFromCw,
  setEpisodesWatched: setEpisodesWatched,
  setItemWatched: setItemWatched,
  sourceHeading: sourceHeading,
  sourceTags: sourceTags,
  sourceText: sourceText,
  streamLanguages: streamLanguages,
  streamRefBody: streamRefBody,
  syncAddons: syncAddons,
  syncCollections: syncCollections,
  titleFacts: titleFacts,
  tx: tx,
  uiLanguage: function () {
    return UI_LANG;
  },
  uiText: function () {
    return { lang: UI_TEXT[UI_LANG] || {}, fallback: UI_TEXT['en-US'] };
  },
  upNextPointer: upNextPointer,
  user: user,
  watchedFromBits: watchedFromBits,
  watchFinished: watchFinished
};
})();
