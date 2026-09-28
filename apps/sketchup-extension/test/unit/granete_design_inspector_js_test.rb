# frozen_string_literal: true

require 'json'
require 'open3'
require_relative '../test_helper'

# #784 R1 — runs the real-JavaScript harness for
# granete-design-inspector.js (the Design Inspector READ module under
# window.GraneteUI.designInspector) and guards the structural wiring: the
# module lives in its own file with its Owns/Does-NOT-own header, dialog.html
# loads it between material-roles and the inspector module (the harness
# loader mirrors that order), the view section exists in the Inspector pane,
# the GraneteDialog wrapper and the binding-status fan-out delegate to the
# module, and the no-selection routing of granete-inspector.js delegates to
# it. Symbol-based, not line-count-based.
class GraneteDesignInspectorJsTest < Minitest::Test
  DESIGN_INSPECTOR_JS = File.expand_path(
    '../../src/granete_for_sketchup/resources/js/granete-design-inspector.js', __dir__
  )
  INSPECTOR_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-inspector.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_design_inspector_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_design_inspector_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_design_inspector_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript design inspector test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 8,
                    'design inspector harness must keep covering the 8 R1 RED cases: bound render, ' \
                    'empty defaults, unbound fallback, selection transitions, design switch, ' \
                    'late-response discard, unknown material and error+retry'
  end

  def test_module_exists_with_ownership_header
    source = File.read(DESIGN_INSPECTOR_JS, encoding: 'UTF-8')
    assert_includes source, '#784 R1 — Design Inspector READ module'
    assert_includes source, '// Owns:'
    assert_includes source, '// Does NOT own:'
    # Session defaults are explicitly NOT a source of truth (R1 authority rule).
    assert_includes source, 'projectDefaultMaterials'
  end

  def test_dialog_loads_the_module_between_material_roles_and_the_inspector
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    mr = html.index('<script src="js/granete-material-roles.js"></script>')
    design = html.index('<script src="js/granete-design-inspector.js"></script>')
    inspector = html.index('<script src="js/granete-inspector.js"></script>')
    refute_nil mr
    refute_nil design
    refute_nil inspector
    assert mr < design && design < inspector,
           'load order must be material-roles → design-inspector → inspector'

    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    loader_mr = loader.index('sources.materialRoles')
    loader_design = loader.index('sources.designInspector')
    loader_inspector = loader.index('sources.inspector,')
    refute_nil loader_design, 'the harness loader must run the REAL granete-design-inspector.js'
    assert loader_mr < loader_design && loader_design < loader_inspector,
           'harness load order must mirror dialog.html'
  end

  def test_dialog_carries_the_design_inspector_view_and_delegation
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    %w[inspector-design-view design-inspector-body design-inspector-design-name
       design-inspector-project-name design-inspector-retry].each do |element_id|
      assert_includes html, %(id="#{element_id}"), "dialog.html must carry ##{element_id}"
    end
    assert_includes html, 'window.GraneteUI.designInspector.onDesignDefaults(payload)',
                    'GraneteDialog.onDesignDefaults must delegate to the module'
    assert_includes html, 'window.GraneteUI.designInspector.onBindingStatus(status)',
                    'the binding-status fan-out must reach the module'
    assert_includes html, 'window.GraneteUI.designInspector.init({',
                    'the bootstrap must init the module with its deps'
  end

  def test_inspector_no_selection_routing_delegates_to_the_design_module
    source = File.read(INSPECTOR_JS, encoding: 'UTF-8')
    assert_includes source, 'designInspector.handleNoSelection()',
                    'the no-selection lane must offer itself to the design module first'
    assert_includes source, 'window.GraneteUI.designInspector.hide()',
                    'hideInspectorViews must retire the design view with every selection'
  end
end
