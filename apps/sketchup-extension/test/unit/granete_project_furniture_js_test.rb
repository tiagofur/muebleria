# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.9: guards the structural contract of the project
# furniture module — the Project Furniture panel (#389 / DT-5: lastPfState
# + in-flight maps, request/reload orchestration, every distinct panel
# state, per-unit rows/actions, the #810 design-sync card, the host
# save-awareness banner and the shared #469 placement-preview Project-lane
# handlers) lives in granete-project-furniture.js with its
# Owns/Consumes/Does-NOT-own header; dialog.html keeps NO project
# furniture implementation symbols; the Ruby bridge names are unchanged
# and stay thin delegation with onProjectFurniture as the inline
# cross-domain orchestrator (Commercial Projection fan-out); the Model
# Binding invalidation seam goes through the module API
# (invalidateProjectFurniture → projectFurniture.invalidate) and the
# connected reload stays in the inline onModelBindingStatus orchestrator;
# the Configurator consumes requestProjectFurniture/pfPlaceFailureMessage
# through the module API. Symbol-based, not line-count-based.
class GraneteProjectFurnitureJsTest < Minitest::Test
  PROJECT_FURNITURE_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/' \
                                          'granete-project-furniture.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_project_furniture_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_project_furniture_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_project_furniture_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript project furniture module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 30,
                    'project furniture harness must keep covering registration/idempotence, ' \
                    'the exact public API, the init contract + fail-fast deps, state ownership ' \
                    '(lastPfState, in-flight maps), request/invalidate/tab-visible semantics, ' \
                    'every panel state, exact bridge calls, the place/confirm/cancel/restore/sync ' \
                    'result handlers, the shared #469 preview handlers, the #810 sync card, the ' \
                    'button listeners and the preserved quirks'
  end

  def test_project_furniture_module_exists_with_ownership_header
    source = File.read(PROJECT_FURNITURE_JS, encoding: 'UTF-8')
    assert_includes source, '#848 Phase B C4.9 — project furniture module'
    assert_includes source, '// Owns:'
    assert_includes source, '// Consumes:'
    assert_includes source, '// Does NOT own:'
    assert_includes source, '#389'
    assert_includes source, '#810'
    assert_includes source, '#469'
    # Focused-bug-entry guidance: a future agent lands here first.
    assert_includes source, 'granete_project_furniture_test.js'
  end

  def test_project_furniture_module_owns_the_panel_implementation
    source = File.read(PROJECT_FURNITURE_JS, encoding: 'UTF-8')
    # State authority lives here.
    ['var lastPfState = null;', 'var pfPlacing = {};', 'var pfConfirming = {};',
     'var pfCancelling = {};', 'var pfRestoring = {};', 'var designSyncBusy = false;',
     'var lastDesignSyncOutcome = null;', 'var PF_ERROR_COPY = {'].each do |symbol|
      assert_includes source, symbol, "granete-project-furniture.js owns #{symbol}"
    end
    # The panel DOM refs moved with the module.
    ['var pfUnbound = document.getElementById', 'var pfListView = document.getElementById',
     'var btnPfRefresh = document.getElementById', 'var btnDesignSync = document.getElementById',
     'var pfSaveAwareness = document.getElementById'].each do |symbol|
      assert_includes source, symbol
    end
    # The render/orchestration/action paths live here.
    ['function renderHostSaveAwareness(', 'function hidePfStates(',
     'function renderDesignSyncCard(', 'function synchronizeDesign(',
     'function handleSynchronizeDesignResult(', 'function requestProjectFurniture(',
     'function renderProjectFurniture(', 'function renderPfList(',
     'function pfUnitCard(', 'function placeFurnitureInstance(',
     'function handlePlacementPreviewStarted(', 'function handlePlacementPreviewCancelled(',
     'function confirmPlacementInstance(', 'function cancelPlacementInstance(',
     'function restoreFurnitureInstance(', 'function handlePlaceFurnitureResult(',
     'function handleConfirmPlacementResult(', 'function handleCancelPlacementResult(',
     'function handleRestoreFurnitureResult(', 'function pfPlaceFailureMessage('].each do |symbol|
      assert_includes source, symbol, "granete-project-furniture.js owns #{symbol}"
    end
    # Exact historical semantics preserved inside the module.
    assert_includes source, 'window.sketchup.select_project_furniture(' \
                            'JSON.stringify({ furnitureInstanceId: row.id }))'
    assert_includes source, 'setTimeout(function () { btnPfRefresh.disabled = false; }, 500)'
    assert_includes source, 'window.GraneteCommercialProjection.refresh()'
  end

  def test_dialog_no_longer_declares_or_implements_the_project_furniture_domain
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var lastPfState', 'var pfPlacing', 'var pfConfirming', 'var pfCancelling',
     'var pfRestoring', 'var designSyncBusy', 'var lastDesignSyncOutcome',
     'var PF_ERROR_COPY', 'function renderHostSaveAwareness(', 'function hidePfStates(',
     'function renderDesignSyncCard(', 'function synchronizeDesign(',
     'function handleSynchronizeDesignResult(', 'function requestProjectFurniture(',
     'function renderProjectFurniture(', 'function renderPfList(', 'function pfUnitCard(',
     'function placeFurnitureInstance(', 'function handlePlacementPreviewStarted(',
     'function handlePlacementPreviewCancelled(', 'function confirmPlacementInstance(',
     'function cancelPlacementInstance(', 'function restoreFurnitureInstance(',
     'function handlePlaceFurnitureResult(', 'function handleConfirmPlacementResult(',
     'function handleCancelPlacementResult(', 'function handleRestoreFurnitureResult(',
     'function pfPlaceFailureMessage('].each do |symbol|
      refute_includes html, symbol, "dialog.html must not carry project furniture implementation: #{symbol}"
    end
    # The panel DOM refs moved with the module.
    refute_includes html, 'var pfUnbound = document.getElementById'
    refute_includes html, 'var pfListView = document.getElementById'
    refute_includes html, 'var btnPfRefresh = document.getElementById'
    refute_includes html, 'var btnDesignSync = document.getElementById'
  end

  def test_dialog_loads_the_project_furniture_module_between_model_binding_and_the_inline_bootstrap
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    model_binding = html.index('<script src="js/granete-model-binding.js"></script>')
    project_furniture = html.index('<script src="js/granete-project-furniture.js"></script>')
    inline = html.index('<script>', project_furniture + 1)
    refute_nil model_binding
    refute_nil project_furniture
    refute_nil inline
    assert model_binding < project_furniture && project_furniture < inline,
           'load order must be model-binding → project-furniture → inline bootstrap'

    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    loader_model_binding = loader.index('sources.modelBinding')
    loader_project_furniture = loader.index('sources.projectFurniture')
    loader_inline = loader.index('sources.inline')
    refute_nil loader_project_furniture, 'the harness loader must run the REAL granete-project-furniture.js'
    assert loader_model_binding < loader_project_furniture && loader_project_furniture < loader_inline,
           'harness load order must mirror dialog.html'
  end

  def test_bootstrap_wires_the_module_before_the_seams_that_consume_it
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    pf_init = html.index('window.GraneteUI.projectFurniture.init({')
    mb_init = html.index('window.GraneteUI.modelBinding.init({')
    config_init = html.index('window.GraneteUI.configurator.init({')
    dialog_ready = html.index('window.sketchup.dialog_ready()')
    refute_nil pf_init
    assert pf_init < mb_init, 'projectFurniture.init must run before modelBinding.init captures the seam'
    assert mb_init < config_init, 'modelBinding.init must run before configurator.init consumes its accessor'
    assert config_init < dialog_ready, 'module wiring must complete before dialog_ready answers Ruby'
    # The seams consume the module API — the temporary inline lastPfState
    # seam from C4.8 is gone.
    assert_includes html, 'invalidateProjectFurniture: window.GraneteUI.projectFurniture.invalidate'
    assert_includes html, 'requestProjectFurniture: window.GraneteUI.projectFurniture.requestProjectFurniture,'
    assert_includes html, 'pfPlaceFailureMessage: window.GraneteUI.projectFurniture.pfPlaceFailureMessage'
    # The switchTab seam delegates the Proyecto-tab lifecycle to the module.
    assert_includes html, 'if (tabId === "project") window.GraneteUI.projectFurniture.onProjectTabVisible();'
  end

  def test_ruby_facing_bridge_wrappers_stay_thin_delegation_with_unchanged_names
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['onProjectFurniture: function (payload) {',
     'window.GraneteUI.projectFurniture.renderProjectFurniture(payload);',
     'onPlaceFurnitureResult: function (result) { ' \
     'window.GraneteUI.projectFurniture.handlePlaceFurnitureResult(result); }',
     'onPlacementPreviewStarted: function (result) { ' \
     'window.GraneteUI.projectFurniture.handlePlacementPreviewStarted(result); }',
     'onPlacementPreviewCancelled: function (result) { ' \
     'window.GraneteUI.projectFurniture.handlePlacementPreviewCancelled(result); }',
     'onConfirmPlacementResult: function (result) { ' \
     'window.GraneteUI.projectFurniture.handleConfirmPlacementResult(result); }',
     'onCancelPlacementResult: function (result) { ' \
     'window.GraneteUI.projectFurniture.handleCancelPlacementResult(result); }',
     'onRestoreFurnitureResult: function (result) { ' \
     'window.GraneteUI.projectFurniture.handleRestoreFurnitureResult(result); }',
     'onSynchronizeDesignResult: function (result) { ' \
     'window.GraneteUI.projectFurniture.handleSynchronizeDesignResult(result); }',
     'onHostSaveAwareness: function (payload) { ' \
     'window.GraneteUI.projectFurniture.renderHostSaveAwareness(payload); }'].each do |wrapper|
      assert_includes html, wrapper, "Ruby bridge wrapper must stay: #{wrapper}"
    end
    # onProjectFurniture keeps the Commercial Projection fan-out in the
    # inline cross-domain orchestrator; the module alone never triggers it.
    orchestrator = html.index('window.GraneteUI.projectFurniture.renderProjectFurniture(payload);')
    projection = html.index('window.GraneteCommercialProjection.setHostReconciliation(payload);')
    refute_nil orchestrator
    refute_nil projection
    assert orchestrator < projection, 'the projection fan-out stays in the onProjectFurniture orchestrator'
    refute_includes File.read(PROJECT_FURNITURE_JS, encoding: 'UTF-8'),
                    'GraneteCommercialProjection.setHostReconciliation',
                    'the module must not acquire the wrapper fan-out'
  end

  def test_model_binding_and_project_furniture_keep_separate_authorities
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    source = File.read(PROJECT_FURNITURE_JS, encoding: 'UTF-8')
    # Project Furniture owns its rows; Model Binding informs through the seam.
    assert_includes source, 'var lastPfState = null;', 'the module owns lastPfState'
    assert_includes source, 'invalidate: function () {', 'the module exposes the invalidation API'
    # The connected reload stays in the inline onModelBindingStatus
    # orchestrator with the exact pre-C4.9 fan-out order.
    orchestrator = html.index('window.GraneteUI.modelBinding.setStatus(status);')
    commercial = html.index('window.GraneteCommercialProjection.setBinding(status);')
    bootstrap_commercial = html.index('window.GraneteCommercialBootstrap.setBinding(status);')
    pf_reload = html.index('if (status && status.state === "connected") ' \
                           'window.GraneteUI.projectFurniture.requestProjectFurniture();')
    refute_nil orchestrator
    refute_nil commercial
    refute_nil bootstrap_commercial
    refute_nil pf_reload
    assert orchestrator < commercial && commercial < bootstrap_commercial && bootstrap_commercial < pf_reload,
           'commercial fan-out + connected PF reload keep their inline orchestrator order'
    # Project Furniture never acquires Model Binding state.
    refute_includes source, 'modelBindingState'
    refute_includes source, 'MODEL_BINDING_COPY'
    # Model Binding never acquires Project Furniture state.
    model_binding_js = File.expand_path('../../src/granete_for_sketchup/resources/js/' \
                                        'granete-model-binding.js', __dir__)
    refute_includes File.read(model_binding_js, encoding: 'UTF-8'), 'var lastPfState'
  end
end
