# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #1046 S3: runs the real-JavaScript harness for
# granete-hardware-group-selector.js (the hardware group member modal under
# window.GraneteUI.hardwareGroupSelector) and guards the structural contract
# of the module — the implementation lives in the external file, dialog.html
# loads it after the finish selector and the loader executes it in order, the
# module owns no catalog slice and never duplicates the finish selector's
# modal logic. Symbol-based, not line-count-based.
class GraneteHardwareGroupSelectorJsTest < Minitest::Test
  SELECTOR_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-hardware-group-selector.js',
                                 __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_hardware_group_selector_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_hardware_group_selector_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_hardware_group_selector_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript hardware group selector test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 5,
                    'the harness must keep covering registration/idempotence/API, row rendering ' \
                    'with the current badge, the selection model (no no-op commits), ' \
                    'Apply-once-and-clear, Cancel/backdrop/Escape without committing, and ' \
                    'the members-empty state'
  end

  def test_implementation_lives_in_granete_hardware_group_selector_js_with_contract_header
    source = File.read(SELECTOR_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.hardwareGroupSelector ='
    # Single ownership of the modal session state slice.
    assert_includes source, 'var session = null;'
    # Pure presentation: the decision rides the injected onPick callback.
    assert_includes source, 'onPick: typeof opts.onPick === "function" ? opts.onPick : null'
    # Agent-first contract header (#848 §10).
    assert_includes source, 'Owns:', 'the module must open with its ownership header'
    assert_includes source, 'Does NOT own:'
    # No catalog authority and no mutation submission inside the module.
    refute_includes source, 'window.sketchup',
                    'the modal never talks to the host directly; the caller decides what a pick means'
    refute_includes source, 'getHardwareCatalog',
                    'member rows arrive prepared by the caller — no second catalog copy here'
  end

  def test_dialog_loads_the_module_and_loader_executes_it_in_order
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    assert_includes html, 'js/granete-hardware-group-selector.js',
                    'dialog.html must load the hardware group selector module'
    finish = html.index('js/granete-finish-selector.js')
    selector = html.index('js/granete-hardware-group-selector.js')
    assert(finish && selector && finish < selector,
           'the selector loads after the finish selector whose modal chrome it shares')

    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    assert_includes loader, 'granete-hardware-group-selector.js',
                    'the Node harness loader must execute the real module file'
  end
end
