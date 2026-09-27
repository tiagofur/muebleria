# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.7 (boundary-adjusted split): guards the structural
# contract of the inspector CHILD module — the part/hardware/aggregate
# surface (#467/#468) lives in granete-inspector-child.js with its
# Owns/Consumes/Does-NOT-own header, keeps NO selectedContext/hardware
# catalog/material-roles/mutation authority, receives the shared
# capability helper by injection (single implementation back in
# dialog.html, consumed by BOTH Inspector modules), is loaded between
# material-roles and granete-inspector.js in both dialog.html and the
# harness loader, is wired by the bootstrap before inspector.init, and
# the main inspector delegates child rendering without regrowing any
# child implementation. Symbol-based, not line-count-based.
class GraneteInspectorChildJsTest < Minitest::Test
  INSPECTOR_CHILD_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/' \
                                        'granete-inspector-child.js', __dir__)
  INSPECTOR_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-inspector.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_child_module_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_inspector_child_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_inspector_child_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript inspector child module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 20,
                    'child module harness must keep covering the child general surface ' \
                    '(part/hardware/aggregate render, breadcrumb, owner recovery, facts, ' \
                    'capabilities), the #468 hardware surface (provenance, anchor labels, ' \
                    'offset, lock, replacement compatibility, drilling conflict, mutations) ' \
                    'and the #467 part surface (authoring gating, move/viewport/duplicate/' \
                    'add/remove, mutation feedback)'
  end

  def test_child_module_exists_with_ownership_header
    source = File.read(INSPECTOR_CHILD_JS, encoding: 'UTF-8')
    assert_includes source, '#848 Phase B C4.7 — inspector CHILD module'
    assert_includes source, '// Owns:'
    assert_includes source, '// Consumes:'
    assert_includes source, '// Does NOT own:'
    # The #467/#468 child surface is named as THIS module's responsibility.
    assert_includes source, '#467'
    assert_includes source, '#468'
  end

  def test_child_module_owns_the_child_surface_and_keeps_no_foreign_authority
    source = File.read(INSPECTOR_CHILD_JS, encoding: 'UTF-8')
    # The child renderers and the #467/#468 interaction live here.
    ['function renderChildInspector(', 'function renderBreadcrumb(', 'function renderChildFacts(',
     'function renderCapabilityList(', 'function renderPartAuthoringCard(',
     'function renderPartAuthoringFeedback(', 'function submitPartMutation(',
     'function partPositionFromInputs(', 'function formatAnchorFace(',
     'var CAPABILITY_LABELS', 'var KIND_BADGES', 'var ANCHOR_FACE_LABELS'].each do |symbol|
      assert_includes source, symbol, "granete-inspector-child.js owns #{symbol}"
    end
    # The #498 authoring/hardware channels are consumed call-time.
    assert_includes source, 'window.GraneteMutation.submitComponentMutation(operation, translation, activeChildContext)'
    assert_includes source, 'window.GraneteMutation.submitHardwarePlacementUpdate(val, activeChildContext)'
    assert_includes source, 'window.GraneteMutation.submitHardwareSubstitution(targetId, activeChildContext)'
    assert_includes source, 'window.GraneteMutation.startComponentViewportMove(activeChildContext)'
    assert_includes source, 'window.sketchup.select_furniture('
  end

  def test_child_module_has_no_state_authority
    source = File.read(INSPECTOR_CHILD_JS, encoding: 'UTF-8')
    # No second selection copy: the context arrives by reference through
    # render(context) and hide() drops it.
    refute_includes source, 'var selectedContext'
    refute_includes source, 'getSelectedContext'
    assert_includes source, 'var activeChildContext'
    assert_includes source, 'activeChildContext = context;'
    assert_includes source, 'activeChildContext = null;'
    # No hardware catalog slice (call-time accessor only).
    refute_includes source, 'var catalogHardware'
    assert_includes source, 'deps.getHardwareCatalog()'
    # No material roles, definition catalog or mutation state machine.
    refute_includes source, 'GraneteUI.materialRoles'
    refute_includes source, 'var catalogMaterials'
    refute_includes source, 'var catalog ='
    refute_includes source, 'function submitUpdate'
    refute_includes source, 'function publishSelection'
    refute_includes source, 'GraneteMutation ='
    refute_includes source, 'GraneteManufacturing ='
    refute_includes source, 'GranetePreflightReview ='
    # No business identity / manufacturing computation (the capability
    # LABELS dictionary may name the Ruby capability; the module never
    # computes or renders manufacturing surfaces).
    refute_includes source, 'GraneteManufacturing.render'
  end

  def test_shared_capability_helper_is_dialog_owned_and_injected_into_both_inspector_modules
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    child = File.read(INSPECTOR_CHILD_JS, encoding: 'UTF-8')
    inspector = File.read(INSPECTOR_JS, encoding: 'UTF-8')
    # Single implementation back in dialog.html (#848 boundary adjustment,
    # §3 sanctioned alternative: the helper is pure and shared by both
    # Inspector modules), injected twice, re-implemented in neither.
    assert_equal 1, html.scan('function capabilityEnabled(context, name) {').count,
                 'dialog.html carries the single shared capability helper'
    assert_equal 2, html.scan('capabilityEnabled: capabilityEnabled').count,
                 'the shared capability helper is injected into BOTH Inspector modules'
    refute_includes child, 'function capabilityEnabled('
    refute_includes inspector, 'function capabilityEnabled('
  end

  def test_dialog_loads_the_child_module_between_material_roles_and_the_inspector
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    mr = html.index('<script src="js/granete-material-roles.js"></script>')
    child = html.index('<script src="js/granete-inspector-child.js"></script>')
    inspector = html.index('<script src="js/granete-inspector.js"></script>')
    inline = html.index('<script>', inspector + 1)
    refute_nil mr
    refute_nil child
    refute_nil inspector
    refute_nil inline
    assert mr < child && child < inspector && inspector < inline,
           'load order must be material-roles → inspector-child → inspector → inline bootstrap'

    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    loader_mr = loader.index('sources.materialRoles')
    loader_child = loader.index('sources.inspectorChild')
    # The comma delimits the exact `sources.inspector` run call — without
    # it the search would match the prefix of `sources.inspectorChild`.
    loader_inspector = loader.index('sources.inspector,')
    loader_inline = loader.index('sources.inline')
    refute_nil loader_child, 'the harness loader must run the REAL granete-inspector-child.js'
    assert loader_mr < loader_child && loader_child < loader_inspector && loader_inspector < loader_inline,
           'harness load order must mirror dialog.html'
  end

  def test_dialog_no_longer_declares_or_implements_the_child_inspector
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['function renderChildInspector(', 'function renderPartAuthoringCard(',
     'function renderPartAuthoringFeedback(', 'function renderBreadcrumb(',
     'function renderChildFacts(', 'function renderCapabilityList(',
     'function submitPartMutation(', 'function partPositionFromInputs(',
     'function formatAnchorFace(', 'var CAPABILITY_LABELS', 'var KIND_BADGES',
     'var ANCHOR_FACE_LABELS', 'var activeChildContext'].each do |symbol|
      refute_includes html, symbol, "dialog.html must not carry child inspector implementation: #{symbol}"
    end
    # The bootstrap wires the child module explicitly, before inspector.init.
    child_init = html.index('window.GraneteUI.inspectorChild.init({')
    inspector_init = html.index('window.GraneteUI.inspector.init({')
    refute_nil child_init
    refute_nil inspector_init
    assert child_init < inspector_init,
           'inspectorChild.init must be wired before inspector.init (which routes child kinds)'
    assert_includes html, 'capabilityEnabled: capabilityEnabled,'
    assert_includes html,
                    'getHardwareCatalog: function () { return window.GraneteUI.inspector.getHardwareCatalog(); }',
                    'the child catalog accessor resolves call-time against the owner module'
  end

  def test_main_inspector_delegates_the_child_lane_without_regrowing_it
    inspector = File.read(INSPECTOR_JS, encoding: 'UTF-8')
    assert_includes inspector, 'window.GraneteUI.inspectorChild.render(context)'
    assert_includes inspector, 'window.GraneteUI.inspectorChild.hide();'
    # The child DOM belongs to the child module: no duplicate refs here.
    %w[inspector-child-view child-breadcrumb hw-placement-card hw-conflict-banner
       part-authoring-card part-pos-x btn-goto-furniture].each do |dom_id|
      refute_includes inspector, dom_id, "granete-inspector.js must not retain the child DOM ref #{dom_id}"
    end
  end
end
