// #848 Phase B — catalog media module.
// Owns:
// - signed catalog media resolution
// - refresh throttling
// - DOM media reapplication
//
// Consumes:
// - window.sketchup.refresh_media_url
// - catalog media payload via explicit API (setCatalogMedia)
//
// Does NOT own:
// - session credentials
// - library rendering
// - material semantics
// - catalog business state
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.media) return;

  // Workshop previews arrive as server-relative paths (/api/media/...).
  // #460 SEC-3: they resolve through SHORT-LIVED signed per-file URLs
  // minted by Ruby (catalogMedia.urls). The extension session credential
  // never enters the webview, and no `?token=` query authentication
  // exists anymore. Missing/expired grants ask Ruby to re-authorize via
  // the refresh_media_url callback and return "" so callers render the
  // placeholder meanwhile.
  var mediaFilenameRe = /\/api\/media\/([0-9a-f]{32}\.(?:jpg|png|webp))/;
  // Filename → timestamp of the last refresh request. A failed mint
  // (offline, expired session) would otherwise leave the flag stuck and
  // the image dead until the dialog reopens; the retry window lets the
  // next render/error retry without hammering Ruby.
  var pendingMediaRefresh = {};
  var MEDIA_REFRESH_RETRY_MS = 5000;

  // Single catalog media authority (#848): the media payload Ruby pushes
  // with setCatalog — never duplicated in dialog.html.
  var catalogMedia = null;

  function mediaUrls() {
    if (!catalogMedia) catalogMedia = { baseUrl: "", urls: {} };
    if (!catalogMedia.urls) catalogMedia.urls = {};
    return catalogMedia.urls;
  }

  function filenameFromPath(url) {
    var m = mediaFilenameRe.exec(String(url || ""));
    return m ? m[1] : null;
  }

  function requestRefresh(filename) {
    if (!filename) return;
    var last = pendingMediaRefresh[filename];
    if (last && Date.now() - last < MEDIA_REFRESH_RETRY_MS) return;
    pendingMediaRefresh[filename] = Date.now();
    try {
      sketchup.refresh_media_url(filename);
    } catch (e) {
      delete pendingMediaRefresh[filename];
    }
  }

  // Re-applies signed URLs to everything currently tagged with its
  // canonical media filename (module <img> cards and material swatches).
  function applyMediaToDom() {
    var nodes = document.querySelectorAll("[data-media-name]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var signed = mediaUrls()[el.getAttribute("data-media-name")];
      if (!signed) continue;
      if (el.tagName === "IMG") {
        if (el.getAttribute("src") !== signed) {
          el.setAttribute("src", signed);
          // A grant landing after the placeholder covered a pending
          // image must reveal the <img> again.
          if (el.style.display === "none") {
            el.style.display = "";
            if (el.nextElementSibling) el.nextElementSibling.style.display = "none";
          }
        }
      } else if (el.style.backgroundImage !== "url('" + signed + "')") {
        el.style.backgroundImage = "url('" + signed + "')";
      }
    }
  }

  window.GraneteUI.media = {
    filenameFromPath: filenameFromPath,

    resolveUrl: function (url) {
      if (!url || typeof url !== "string") return url;
      if (url.indexOf("http") === 0 || url.indexOf("data:") === 0) return url;
      if (url.indexOf("/api/media/") !== 0) return url;
      var filename = filenameFromPath(url);
      if (!filename) return url;
      var signed = mediaUrls()[filename];
      if (signed) return signed;
      requestRefresh(filename);
      return "";
    },

    requestRefresh: requestRefresh,

    updateSignedUrl: function (filename, url) {
      if (!filename || !url) return;
      mediaUrls()[filename] = url;
      delete pendingMediaRefresh[filename];
      applyMediaToDom();
    },

    setCatalogMedia: function (media) {
      catalogMedia = media || null;
    }
  };
})();
