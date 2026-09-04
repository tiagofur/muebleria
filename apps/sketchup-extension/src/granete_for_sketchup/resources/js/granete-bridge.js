// #498 / SU-HOST-1 — versioned, validated Ruby↔JavaScript bridge for the
// host runtime channel (granete.sketchup-host-command.v1, the JS mirror of
// Host::CommandContract). Ruby→JS envelopes are validated fail-closed
// BEFORE any view/state consumes them; JS→Ruby commands carry schema id,
// correlation (messageId) and an explicit semantic target. Unknown
// schema/type/message shape is rejected, never guessed. Idempotent:
// re-execution registers nothing twice (dialog reopen safety).
(function () {
  "use strict";
  if (window.GraneteBridge) return;

  var SCHEMA_ID = "granete.sketchup-host-command.v1";
  var MESSAGE_TYPES = ["mutation_command", "mutation_state", "preflight_state", "degraded_state"];
  var MAX_ID_LENGTH = 128;
  var sequence = 0;

  function nonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  window.GraneteBridge = {
    SCHEMA_ID: SCHEMA_ID,
    MESSAGE_TYPES: MESSAGE_TYPES,

    // Returns { ok: true } or { ok: false, reason } — behavior branches on
    // the boolean/reason code, never on message text.
    validate: function (envelope, expectedType) {
      if (!envelope || typeof envelope !== "object") return { ok: false, reason: "not_object" };
      if (envelope.schemaId !== SCHEMA_ID) return { ok: false, reason: "schema_mismatch" };
      if (MESSAGE_TYPES.indexOf(envelope.type) === -1) return { ok: false, reason: "unknown_type" };
      if (envelope.type !== expectedType) return { ok: false, reason: "unexpected_type" };
      if (!nonEmptyString(envelope.messageId) || envelope.messageId.length > MAX_ID_LENGTH) {
        return { ok: false, reason: "invalid_message_id" };
      }
      return { ok: true };
    },

    nextMessageId: function () {
      sequence += 1;
      return "cmd-mut-" + sequence + "-" + Math.random().toString(36).substring(2, 10);
    },

    // Sends a versioned mutation command through the Ruby action callback.
    // Returns the allocated messageId (or null when the host bridge is
    // unavailable — browser preview).
    sendCommand: function (mutation, semanticTarget, payload) {
      var messageId = this.nextMessageId();
      var envelope = {
        schemaId: SCHEMA_ID,
        type: "mutation_command",
        messageId: messageId,
        mutation: mutation,
        semanticTarget: semanticTarget,
        payload: payload || {}
      };
      var host = window.sketchup;
      if (host && typeof host.authoring_mutation === "function") {
        host.authoring_mutation(JSON.stringify(envelope));
        return messageId;
      }
      return null;
    }
  };
})();
