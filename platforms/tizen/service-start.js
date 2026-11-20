// Starts the app's local service. Inlined by build-tizen.js before anything else on every page,
// since the opening page needs it before the interface script runs.
// Two ways, both asked at once, since asking a running service again does nothing:
// - launchAppControl, which every Samsung TV had;
// - the wrt:service module, the way Samsung's guide shows now. On Tizen 9 and newer
//   launchAppControl answers but no service comes up (TizenBrew and other apps met the same).
//   A browser too old for module scripts skips the one asking for it, so older TVs are unchanged.
// cb(true) once either way is accepted, cb(false) when neither is; the service may still need
// a moment before it listens.
/* exported tizenStartService */
var TIZEN_MODULE_WAIT_MS = 3000;
var tizenServiceModule = null,
  tizenModuleAsked = false,
  tizenModuleWaiting = [];
function tizenModuleSettled() {
  var waiting = tizenModuleWaiting;
  tizenModuleWaiting = [];
  for (var i = 0; i < waiting.length; i++) waiting[i](tizenServiceModule);
}
function tizenWithServiceModule(cb) {
  if (tizenServiceModule || (tizenModuleAsked && !tizenModuleWaiting.length)) return cb(tizenServiceModule);
  tizenModuleWaiting.push(cb);
  if (tizenModuleAsked) return;
  tizenModuleAsked = true;
  window.__SC_WRT_SERVICE__ = function (m) {
    tizenServiceModule = m || null;
    tizenModuleSettled();
  };
  setTimeout(tizenModuleSettled, TIZEN_MODULE_WAIT_MS);
  try {
    var s = document.createElement('script');
    s.type = 'module';
    s.text = "import * as m from 'wrt:service'; window.__SC_WRT_SERVICE__(m);";
    s.onerror = tizenModuleSettled;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    tizenModuleSettled();
  }
}
function tizenStartService(serviceId, cb) {
  var answers = 0,
    accepted = false;
  function answer(ok) {
    answers++;
    if (accepted) return;
    if (ok || answers === 2) {
      accepted = ok;
      cb(ok);
    }
  }
  try {
    tizen.application.launchAppControl(
      new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
      serviceId,
      function () {
        answer(true);
      },
      function () {
        answer(false);
      }
    );
  } catch (e) {
    answer(false);
  }
  tizenWithServiceModule(function (m) {
    var started = null;
    try {
      if (m && typeof m.startService === 'function') started = m.startService(serviceId);
      else if (m && typeof m.Service === 'function') started = new m.Service(serviceId).start();
      else return answer(false);
    } catch (e) {
      return answer(false);
    }
    if (started && typeof started.then === 'function')
      started.then(
        function () {
          answer(true);
        },
        function () {
          answer(false);
        }
      );
    else answer(true);
  });
}
