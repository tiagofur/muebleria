# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.7: runs the real-JavaScript harness for
# granete-inspector.js (the inspector module under window.GraneteUI) and
# guards the structural contract of the extraction — the implementation
# lives in the external file with its Owns/Consumes/Does-NOT-own header,
# dialog.html loads it after the material-roles module and before the
# inline bootstrap (in both the HtmlDialog and the harness loader), the
# monolith never re-grows the Inspector state/renderers/bindings, the
# GraneteDialog Ruby-facing wrappers stay thin delegation, the Material
# Roles read-only Inspector accessors resolve against the module, the
# hardware catalog slice is owned by the module (setCatalog object branch
# delegates; the array branch preserves the historical non-reset), the
# GraneteState projection reads the module API, and no
# GraneteMutation/Manufacturing/Preflight logic is duplicated.
# Symbol-based, not line-count-based.
class GraneteInspectorJsTest < Minitest::Test
  INSPECTOR_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-inspector.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_inspector_module_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_inspector_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_inspector_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript inspector module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 25,
                    'inspector module harness must keep covering registration/API, selection ' \
                    'lifecycle, capability gating, update payload/rollback, material-choice ' \
                    'routing, delete arm/confirm, child-kind routing delegation and the hardware ' \
                    'catalog ownership (child-focused coverage lives in ' \
                    'granete_inspector_child_test.js per the #848 boundary adjustment)'
  end

  def test_module_exists_with_ownership_header
    source = File.read(INSPECTOR_JS, encoding: 'UTF-8')
    assert_includes source, '#848 Phase B C4.7 — inspector module'
    assert_includes source, '// Owns:'
    assert_includes source, '// Consumes:'
    assert_includes source, '// Does NOT own:'
    # Working-copy state ownership, named by the slice.
    %w[selectedContext inspectorDef inspectorParams inspectorMaterialChoices catalogHardware].each do |symbol|
      assert_includes source, "var #{symbol}", "granete-inspector.js owns #{symbol}"
    end
  end

  def test_dialog_loads_the_module_between_material_roles_and_the_inline_bootstrap
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    mr = html.index('<script src="js/granete-material-roles.js"></script>')
    inspector = html.index('<script src="js/granete-inspector.js"></script>')
    inline = html.index('<script>', inspector + 1)
    refute_nil mr
    refute_nil inspector
    refute_nil inline
    assert mr < inspector && inspector < inline,
           'load order must be material-roles → inspector → inline bootstrap'

    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    loader_mr = loader.index('sources.materialRoles')
    # The comma delimits the exact `sources.inspector` run call — without
    # it the search would match the prefix of `sources.inspectorChild`.
    loader_inspector = loader.index('sources.inspector,')
    loader_inline = loader.index('sources.inline')
    refute_nil loader_inspector, 'the harness loader must run the REAL granete-inspector.js'
    assert loader_mr < loader_inspector && loader_inspector < loader_inline,
           'harness load order must mirror dialog.html'
  end

  def test_dialog_no_longer_declares_or_implements_the_inspector
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    # State declarations moved (one authority in the module).
    ['var selectedContext', 'var inspectorDef', 'var inspectorParams',
     'var inspectorMaterialChoices', 'var catalogHardware'].each do |declaration|
      refute_includes html, declaration, "dialog.html must not declare #{declaration}"
    end
    # Render/action implementations moved.
    ['function renderInspector(', 'function renderFurnitureInspector(', 'function renderChildInspector(',
     'function renderPartAuthoringCard(', 'function renderPartAuthoringFeedback(', 'function renderBreadcrumb(',
     'function renderChildFacts(', 'function renderCapabilityList(', 'function renderManufacturingCard(',
     'function hideInspectorViews(', 'function formatAnchorFace(',
     'function validateInteractiveClient(', 'function updateInspectorSummary(',
     'function resetDeleteConfirm(', 'function submitPartMutation(', 'function partPositionFromInputs(',
     'var CAPABILITY_LABELS', 'var KIND_BADGES', 'var ANCHOR_FACE_LABELS',
     'var deleteArmed', 'var deleteArmTimer'].each do |symbol|
      refute_includes html, symbol, "dialog.html must not carry inspector implementation: #{symbol}"
    end
    # No second copy of the module render paths anywhere in the bootstrap.
    refute_includes html, 'window.GraneteUI.inspector.render'
  end

  def test_granete_dialog_wrappers_stay_ruby_compatible_thin_delegation
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    {
      'onSelectionChange' => 'function (context)',
      'onUpdateResult' => 'function (result)',
      'onDeleteResult' => 'function (result)',
      'onMaterialChoiceApplied' => 'function (payload)',
      'activateInspectorTab' => 'function ()'
    }.each do |name, signature|
      assert_includes html, "#{name}: #{signature}",
                      "GraneteDialog.#{name} must stay as the Ruby-facing wrapper"
    end
    # Thin delegation, not re-implementation: every wrapper's body is a
    # single delegation to the module (no local state reads beyond the
    # forwarded argument).
    [
      "onSelectionChange: function (context) {\n            window.GraneteUI.inspector.onSelectionChange(context);",
      "onUpdateResult: function (result) {\n            window.GraneteUI.inspector.onUpdateResult(result);",
      "onDeleteResult: function (result) {\n            window.GraneteUI.inspector.onDeleteResult(result);",
      "onMaterialChoiceApplied: function (payload) {\n            " \
      'window.GraneteUI.inspector.onMaterialChoiceApplied(payload);',
      "activateInspectorTab: function () {\n            window.GraneteUI.inspector.activateInspectorTab();"
    ].each do |body|
      assert_includes html, body, 'GraneteDialog wrapper must delegate to window.GraneteUI.inspector'
    end
  end

  def test_material_roles_inspector_accessors_resolve_against_the_module
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    assert_includes html,
                    'getInspectorMaterialsCard: function () { return window.GraneteUI.inspector.getMaterialsCard(); }'
    assert_includes html, 'getInspectorDef: function () { return window.GraneteUI.inspector.getDefinition(); }'
    assert_includes html, 'getSelectedContext: function () { return window.GraneteUI.inspector.getSelectedContext(); }'
    refute_includes html, 'return inspectorMaterialsCard;',
                    'the bootstrap must not read a proxy copy of the inspector DOM ref'
    refute_includes html, 'return inspectorDef;',
                    'the bootstrap must not read a proxy copy of inspectorDef'
    refute_includes html, 'return selectedContext;',
                    'the bootstrap must not read a proxy copy of selectedContext'
  end

  def test_hardware_catalog_slice_is_module_owned_with_the_historical_quirk
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    source = File.read(INSPECTOR_JS, encoding: 'UTF-8')
    # Object branch delegates; the GraneteState projection reads the module.
    assert_includes html, 'window.GraneteUI.inspector.setHardwareCatalog(payload.hardware || []);'
    assert_includes html, 'hardware: window.GraneteUI.inspector.getHardwareCatalog(),'
    assert_includes source, 'function setHardwareCatalog(hardware) {'
    assert_includes source, 'catalogHardware = hardware || [];'
    # The array-legacy branch must NOT touch the hardware slice (historical
    # non-reset behavior): no inspector hardware call inside the array arm.
    array_arm = html.index('if (isArray) {')
    object_arm = html.index('} else {', array_arm)
    assert array_arm && object_arm
    array_body = html[array_arm...object_arm]
    refute_includes array_body, 'setHardwareCatalog',
                    'the array-payload branch preserves the historical hardware non-reset'
  end

  def test_bootstrap_wires_the_inspector_before_material_roles_and_dialog_ready
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    account_init = html.index('window.GraneteUI.account.init({')
    library_init = html.index('window.GraneteUI.library.init({')
    inspector_init = html.index('window.GraneteUI.inspector.init({')
    mr_init = html.index('window.GraneteUI.materialRoles.init({')
    config_init = html.index('window.GraneteUI.configurator.init({')
    dialog_ready = html.index('window.sketchup.dialog_ready()')
    refute_nil account_init
    refute_nil library_init
    refute_nil inspector_init
    refute_nil mr_init
    refute_nil config_init
    refute_nil dialog_ready
    assert inspector_init < mr_init,
           'inspector.init must run before materialRoles.init wires its accessors'
    assert library_init < inspector_init
    assert mr_init < config_init
    assert config_init < dialog_ready
    # The injected shared helpers stay single-implementation in the dialog.
    assert_includes html, 'window.GraneteUI.inspector.init({'
    assert_includes html, 'getDefaultParams: getDefaultParams,'
    assert_includes html, 'renderParamForm: renderParamForm,'
    assert_includes html, 'estimatedPartsLabel: estimatedPartsLabel,'
    assert_includes html, 'parameterIssueMessage: parameterIssueMessage'
  end

  def test_no_duplicated_runtime_logic_in_the_module
    source = File.read(INSPECTOR_JS, encoding: 'UTF-8')
    # The module CALLS the #498 runtime controllers; it never re-implements
    # their state machines or rendering.
    refute_includes source, 'function publishSelection'
    refute_includes source, 'function submitUpdate'
    refute_includes source, 'GraneteMutation ='
    refute_includes source, 'GraneteManufacturing ='
    refute_includes source, 'GranetePreflightReview ='
    # Call-time consumption only.
    assert_includes source, 'window.GraneteMutation.submitUpdate(payload, selectedContext)'
    assert_includes source, 'window.GraneteMutation.publishSelection(selectedContext)'
    # The child surface is delegated to granete-inspector-child.js: the
    # routing passes the SAME context object and every top-level re-render
    # drops the child lane; no child implementation regrows here.
    assert_includes source, 'window.GraneteUI.inspectorChild.render(context)'
    assert_includes source, 'window.GraneteUI.inspectorChild.hide();'
    ['function renderChildInspector(', 'function renderPartAuthoringCard(', 'function renderBreadcrumb(',
     'function renderChildFacts(', 'function renderCapabilityList(', 'function submitPartMutation(',
     'function partPositionFromInputs(', 'function formatAnchorFace(',
     'var CAPABILITY_LABELS', 'var KIND_BADGES', 'var ANCHOR_FACE_LABELS'].each do |symbol|
      refute_includes source, symbol, "granete-inspector.js must not regrow child implementation: #{symbol}"
    end
    # No material/definition catalog copies.
    refute_includes source, 'var catalogMaterials'
    refute_includes source, 'var catalog ='
    # Library/materialRoles boundaries stay namespaced reads.
    assert_includes source, 'window.GraneteUI.library.findDefinitionById('
    assert_includes source, 'window.GraneteUI.materialRoles.defaultMaterialChoices('
    assert_includes source, 'window.GraneteUI.materialRoles.renderMaterialSelectors('
  end
end
