// #498 / SU-HOST-1 — single dialog state authority for the new runtime
// surfaces (session, catalog, selection, mutation, preflight, degraded).
// Views subscribe; nobody mutates slices in place from the outside. The
// legacy inline script keeps its own working variables — this store owns
// the shared host-runtime state so #466–#468 add views without inventing
// parallel truths. Idempotent: re-executing the file registers nothing
// twice (dialog reopen safety).
(function () {
  "use strict";
  if (window.GraneteState) return;

  var state = {
    session: null,
    catalog: null,
    selection: null,
    mutation: {
      phase: "idle",
      outcome: null,
      category: null,
      reason: null,
      messageId: null,
      target: null
    },
    preflight: { entries: {} },
    degraded: null,
    manufacturing: { mode: "off", status: "off", features: [] }
  };

  var listeners = [];

  function notify(slice) {
    listeners.slice().forEach(function (listener) {
      try { listener(slice, state[slice]); } catch (e) { /* view errors never break the store */ }
    });
  }

  window.GraneteState = {
    SLICES: ["session", "catalog", "selection", "mutation", "preflight", "degraded", "manufacturing"],

    get: function (slice) {
      return state[slice];
    },

    set: function (slice, value) {
      if (state[slice] === undefined) throw new Error("unknown state slice: " + slice);
      state[slice] = value;
      notify(slice);
    },

    update: function (slice, patch) {
      if (state[slice] === undefined) throw new Error("unknown state slice: " + slice);
      var current = state[slice];
      state[slice] = Object.assign({}, current, patch);
      notify(slice);
    },

    subscribe: function (listener) {
      listeners.push(listener);
      return function unsubscribe() {
        var index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }
  };
})();
