# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #1535 — runs the real-JavaScript harness for granete-grip.js (the project
# grip module under window.GraneteUI) and guards the structural contract:
# the module is external, dialog.html loads it before the inline bootstrap,
# the retired opening module never re-grows, and the harness keeps covering
# the six card states plus the project-keyed late-answer drop.
class GraneteGripJsTest < Minitest::Test
  GRIP_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-grip.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)

  def test_real_javascript_grip_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_grip_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_grip_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript grip module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 10,
                    'grip harness must keep covering the six card states, ' \
                    'the project-keyed drop and the undo/redo intentions'
  end

  def test_grip_implementation_lives_in_granete_grip_js
    source = File.read(GRIP_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.grip'
    assert_includes source, 'apply_project_grip_style'
    assert_includes source, 'apply_project_grip_furniture'
    assert_includes source, 'undo_project_grip'
    # The plugin never computes: the sentences come from the server report.
    assert_includes source, 'sentenceFor'
    assert_includes source, 'boundProjectId', 'state must key on the bound project'
  end

  def test_dialog_html_loads_grip_module_before_the_inline_script
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    grip_tag = html.index('<script src="js/granete-grip.js"></script>')
    inline_tag = html.index('<script>')
    refute_nil grip_tag, 'dialog.html must load js/granete-grip.js'
    refute_nil inline_tag, 'dialog.html must keep its inline bootstrap script'
    assert grip_tag < inline_tag,
           'the grip module loads BEFORE the inline script that consumes GraneteUI.grip'
  end

  def test_retired_opening_module_stays_retired
    # The duplicated «Apertura del diseño» cards died with #1535: the facade
    # module is gone from the dialog and its markup never re-grows.
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    refute_includes html, 'granete-opening.js'
    refute_includes html, 'Apertura del diseño'
    assert_includes html, '>Agarre del proyecto<'
    assert_includes html, '>Apertura</div>', 'card C is renamed «Apertura»'
    refute File.exist?(File.expand_path('../../src/granete_for_sketchup/resources/js/granete-opening.js', __dir__)),
           'granete-opening.js stays deleted'
  end
end
