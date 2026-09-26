# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B pilot: runs the real-JavaScript harness for granete-media.js
# (the catalog media module under window.GraneteUI) and guards the
# structural contract of the extraction — the implementation lives in the
# external file, dialog.html loads it before the inline bootstrap, and the
# monolith never re-grows the media code. Symbol-based, not line-count-based.
class GraneteMediaJsTest < Minitest::Test
  MEDIA_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-media.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)

  def test_real_javascript_media_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_media_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_media_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript media module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 10,
                    'media harness must keep covering authority, throttle, ' \
                    'DOM reapplication and stale-reset semantics'
  end

  def test_media_implementation_lives_in_granete_media_js_with_contract_header
    source = File.read(MEDIA_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.media ='
    assert_includes source, 'MEDIA_REFRESH_RETRY_MS = 5000'
    assert_includes source, 'sketchup.refresh_media_url'
    assert_includes source, 'data-media-name'
    # Agent-first contract header (#848 §10).
    assert_includes source, 'Owns:', 'granete-media.js must open with its ownership header'
    assert_includes source, 'Does NOT own:'
  end

  def test_dialog_html_loads_media_module_before_the_inline_script
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    media_tag = html.index('<script src="js/granete-media.js"></script>')
    inline_tag = html.index('<script>')
    refute_nil media_tag, 'dialog.html must load js/granete-media.js'
    refute_nil inline_tag, 'dialog.html must keep its inline bootstrap script'
    assert media_tag < inline_tag,
           'the media module loads BEFORE the inline script that consumes GraneteUI.media'
  end

  def test_dialog_html_no_longer_carries_the_media_implementation
    # The monolith must not re-grow what Phase B extracted: only the
    # window.GraneteUI.media API calls may remain inline.
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var catalogMedia', 'mediaFilenameRe', 'pendingMediaRefresh', 'MEDIA_REFRESH_RETRY_MS',
     'function mediaFilenameFromPath', 'function mediaUrls', 'function requestMediaRefresh',
     'function resolveMediaUrl', 'function applyMediaToDom'].each do |symbol|
      refute_includes html, symbol,
                      "media implementation symbol #{symbol} belongs in granete-media.js"
    end
  end
end
