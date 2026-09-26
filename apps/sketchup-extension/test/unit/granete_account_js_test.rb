# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.2: runs the real-JavaScript harness for granete-account.js
# (the account/session/device-enrollment module under window.GraneteUI) and
# guards the structural contract of the extraction — the implementation lives
# in the external file, dialog.html loads it after the media module and
# before the inline bootstrap, the GraneteDialog bridge keeps its Ruby-facing
# wrappers as thin delegation, and the monolith never re-grows the account
# code. Symbol-based, not line-count-based.
class GraneteAccountJsTest < Minitest::Test
  ACCOUNT_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-account.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)

  def test_real_javascript_account_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_account_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_account_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript account module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 25,
                    'account harness must keep covering popover interaction, focus, ' \
                    'enrollment lifecycle, 5s polling, 429 resilience, cleanup, logout, ' \
                    'web-devices URL derivation and copy fallback'
  end

  def test_account_implementation_lives_in_granete_account_js_with_contract_header
    source = File.read(ACCOUNT_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.account ='
    assert_includes source, 'sketchup.poll_enrollment'
    assert_includes source, 'sketchup.open_external_url'
    assert_includes source, 'sketchup.logout'
    # Single ownership of the enrollment state slice.
    assert_includes source, 'var currentEnrollmentId'
    # Explicit injected dependencies — no duplicated inline helpers.
    assert_includes source, 'deps.showToast'
    assert_includes source, 'deps.icon'
    # Agent-first contract header (#848 §10).
    assert_includes source, 'Owns:', 'granete-account.js must open with its ownership header'
    assert_includes source, 'Does NOT own:'
  end

  def test_dialog_html_loads_account_module_between_media_and_the_inline_script
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    media_tag = html.index('<script src="js/granete-media.js"></script>')
    account_tag = html.index('<script src="js/granete-account.js"></script>')
    inline_tag = html.index('<script>')
    refute_nil media_tag, 'dialog.html must load js/granete-media.js'
    refute_nil account_tag, 'dialog.html must load js/granete-account.js'
    refute_nil inline_tag, 'dialog.html must keep its inline bootstrap script'
    assert media_tag < account_tag,
           'the account module loads after the media module (dialog load order)'
    assert account_tag < inline_tag,
           'the account module must be ready BEFORE the inline script answers dialog_ready'
  end

  def test_dialog_html_no_longer_carries_the_account_implementation
    # The monolith must not re-grow what Phase B extracted: only the
    # window.GraneteUI.account API calls and the thin GraneteDialog
    # delegation may remain inline.
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var currentEnrollmentId', 'var enrollPollInterval', 'var enrollCountdownInterval',
     'var accountPopover', 'var accountCloseBtn', 'var sessionLicense',
     'function accountFocusTarget', 'function openAccountPopover',
     'function closeAccountPopover', 'function renderSessionLicense',
     'function fallbackCopy'].each do |symbol|
      refute_includes html, symbol,
                      "account implementation symbol #{symbol} belongs in granete-account.js"
    end
  end

  def test_granete_dialog_keeps_the_ruby_facing_account_wrappers_as_delegation
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    {
      'setStatus' => 'window.GraneteUI.account.setStatus(status)',
      'clearEnrollmentTimers' => 'window.GraneteUI.account.clearEnrollmentTimers()',
      'startEnrollCountdown' => 'window.GraneteUI.account.startEnrollCountdown(expiresAtStr)',
      'onEnrollResult' => 'window.GraneteUI.account.onEnrollResult(result)',
      'onPollResult' => 'window.GraneteUI.account.onPollResult(result)',
      'onLoginResult' => 'window.GraneteUI.account.onLoginResult(result)'
    }.each do |method, delegation|
      assert_includes html, "#{method}: function",
                      "GraneteDialog must keep the #{method} bridge wrapper Ruby calls"
      assert_includes html, delegation,
                      "the #{method} wrapper must delegate to GraneteUI.account"
    end
    # The bootstrap injects the shared presentation helpers before Ruby can
    # answer dialog_ready.
    assert_includes html, 'window.GraneteUI.account.init({ showToast: showToast, icon: icon })'
  end
end
