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
