# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.4: runs the real-JavaScript harness for
# granete-configurator.js (the configurator module under window.GraneteUI)
# and guards the structural contract of the extraction — the
# implementation lives in the external file, dialog.html loads it after
# the library module and before the inline bootstrap, the monolith never
# re-grows the configurator code, GraneteDialog keeps its Ruby-facing
# wrappers as thin delegation, the Library hand-off goes through the
# Configurator API and catalogPresets has exactly one owner.
# Symbol-based, not line-count-based.
class GraneteConfiguratorJsTest < Minitest::Test
  CONFIGURATOR_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-configurator.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)

  def test_real_javascript_configurator_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_configurator_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_configurator_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript configurator module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 30,
                    'configurator harness must keep covering registration, open/close, ' \
                    'active definition identity, preview + fallback, default params and edits, ' \
                    'registered measures, presets, summary, material choices snapshot, ' \
                    'insert labels, the catalog placement payload with idempotency, the #469 ' \
                    'repeat loop, cancel/re-arm and the legacy fallbacks'
  end

  def test_configurator_implementation_lives_in_granete_configurator_js_with_contract_header
    source = File.read(CONFIGURATOR_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.configurator ='
    # Single ownership of the configurator state slice.
    assert_includes source, 'var activeLibDef = null;'
    assert_includes source, 'var libParams = {};'
    assert_includes source, 'var libMaterialChoices = {};'
    assert_includes source, 'var catalogPresets = [];'
    assert_includes source, 'var catalogCreateIntentKey = null;'
    assert_includes source, 'var lastCatalogPlacementPayload = null;'
    assert_includes source, 'var repeatPreviewActive = false;'
    # Explicit injected dependencies — no duplicated inline helpers
    # (param/material forms and summaries stay shared with the Inspector).
    %w[icon showToast createFurniturePlaceholderSvg getDefaultParams renderParamForm
       defaultMaterialChoices renderMaterialSelectors materialById estimatedPartsLabel
       parameterIssueMessage isModelConnected setProjectDefaultMaterial switchTab
       requestProjectFurniture pfPlaceFailureMessage].each do |dep|
      assert_includes source, "deps.#{dep}", "dependency #{dep} must be consumed injected"
    end
    # Media/Library boundaries stay namespaced consumers, never copies.
    assert_includes source, 'window.GraneteUI.media.filenameFromPath'
    assert_includes source, 'window.GraneteUI.library.formatCategoryLabel'
    assert_includes source, 'window.GraneteUI.library.findDefinitionById'
    assert_includes source, 'window.sketchup.begin_catalog_placement_preview'
    # Agent-first contract header (#848 §10).
    assert_includes source, 'Owns:', 'granete-configurator.js must open with its ownership header'
    assert_includes source, 'Does NOT own:'
    # The module must NOT duplicate the shared helpers it consumes.
    ['function getDefaultParams(', 'function renderParamForm(', 'function defaultMaterialChoices(',
     'function renderMaterialSelectors(', 'function estimatedPartsLabel(',
     'function parameterIssueMessage(', 'function materialById('].each do |symbol|
      refute_includes source, symbol, "shared helper #{symbol} must stay injected, not duplicated"
    end
  end

  def test_dialog_html_loads_configurator_module_between_library_and_the_inline_script
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    media_tag = html.index('<script src="js/granete-media.js"></script>')
    account_tag = html.index('<script src="js/granete-account.js"></script>')
    library_tag = html.index('<script src="js/granete-library.js"></script>')
    configurator_tag = html.index('<script src="js/granete-configurator.js"></script>')
    inline_tag = html.index('<script>')
    refute_nil media_tag, 'dialog.html must load js/granete-media.js'
    refute_nil account_tag, 'dialog.html must load js/granete-account.js'
    refute_nil library_tag, 'dialog.html must load js/granete-library.js'
    refute_nil configurator_tag, 'dialog.html must load js/granete-configurator.js'
    refute_nil inline_tag, 'dialog.html must keep its inline bootstrap script'
    assert library_tag < configurator_tag,
           'the configurator module loads after the library module (dialog load order)'
    assert configurator_tag < inline_tag,
           'the configurator module must be registered BEFORE the inline bootstrap wires the hand-off'
  end

  def test_dialog_html_no_longer_carries_the_configurator_implementation
    # The monolith must not re-grow what Phase B extracted: only the
    # window.GraneteUI.configurator API calls and the thin GraneteDialog
    # orchestration may remain inline.
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var activeLibDef', 'var libParams =', 'var libMaterialChoices', 'var catalogPresets',
     'var catalogCreateIntentKey', 'var lastCatalogPlacementPayload', 'var repeatPreviewActive',
     'function showLibraryView(', 'function showConfiguratorView(',
     'function renderConfiguratorPreview(', 'function updateLibraryInsertButton(',
     'function bindLibraryParamForm(', 'function registeredMeasureParams(',
     'function renderRegisteredMeasuresButton(', 'function renderPresetChips(',
     'function updateLibrarySummary(', 'function getOrCreateCatalogIntentKey(',
     'function clearCatalogIntentKey(', 'function generateIdempotencyKey(',
     'function beginRepeatCatalogPreview(', 'function handleCreateProjectFurnitureResult('].each do |symbol|
      refute_includes html, symbol,
                      "configurator implementation symbol #{symbol} belongs in granete-configurator.js"
    end
  end

  def test_granete_dialog_wrappers_stay_compatible_and_delegate_to_the_module
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    # Ruby keeps calling GraneteDialog with the same names and payloads;
    # the configurator lane becomes thin delegation.
    assert_includes html, 'onInsertionResult: function (result) {'
    assert_includes html, 'window.GraneteUI.configurator.onInsertionResult(result);'
    assert_includes html, 'onCreateProjectFurnitureResult: function (result) {'
    assert_includes html, 'window.GraneteUI.configurator.onCreateProjectFurnitureResult(result); }'
    assert_includes html,
                    'getCatalogCreateIntentKey: function () { return window.GraneteUI.configurator.getIntentKey(); }'
    # setCatalog keeps the presets/materials/hardware split: presets belong
    # to the configurator (single authority), materials stay until their
    # own slice, and the post-refresh re-entry delegates wholesale.
    assert_includes html, 'window.GraneteUI.configurator.setPresets(payload.presets || []);'
    assert_includes html, 'window.GraneteUI.configurator.setPresets([]);'
    assert_includes html, 'window.GraneteUI.configurator.refreshAfterCatalog();'
    assert_includes html, 'catalogMaterials = payload.materials || [];'
    # The shared #469 placement preview handlers stay inline (they serve
    # the Project lane too) and read the catalog entry point through the
    # module API.
    assert_includes html, 'window.GraneteUI.configurator.isRepeatPreviewActive()'
    assert_includes html, 'window.GraneteUI.configurator.cancelRepeatPreview()'
    assert_includes html, 'window.GraneteUI.configurator.rearmInsertButton()'
    # Selection/material routing reads the module's exact presence
    # semantics, not a duplicated definition copy.
    assert_includes html, 'window.GraneteUI.configurator.hasActiveDefinition()'
    assert_includes html, 'window.GraneteUI.configurator.applyMaterialChoice(role, materialId, isProjectScope)'
  end

  def test_library_handoff_goes_through_the_configurator_api_only_after_init
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    # Library ends at the choice: the wiring resolves the module at call
    # time (never a captured pre-init reference).
    assert_includes html, 'onSelectDefinition: function (def) {'
    assert_includes html, 'window.GraneteUI.configurator.open(def);'
    assert_includes html, 'getSelectedDefinitionId: function () {'
    assert_includes html, 'return window.GraneteUI.configurator.getActiveDefinitionId();'
    # The bootstrap injects the shared helpers (single implementation,
    # also consumed by the Inspector), the model-connected accessor and
    # the project-default write BEFORE any module render can run.
    assert_includes html, 'window.GraneteUI.configurator.init({'
    assert_includes html, 'getDefaultParams: getDefaultParams,'
    assert_includes html, 'renderParamForm: renderParamForm,'
    assert_includes html, 'renderMaterialSelectors: renderMaterialSelectors,'
    assert_includes html, 'estimatedPartsLabel: estimatedPartsLabel,'
    assert_includes html, 'isModelConnected: function () {'
    assert_includes html, 'setProjectDefaultMaterial: function (role, id) {'
    # Initial view + initial binding render run after the injection.
    assert_includes html, 'window.GraneteUI.configurator.close();'
    bootstrap = html.index('window.GraneteUI.configurator.init({')
    initial_view = html.index('window.GraneteUI.configurator.close();')
    refute_nil bootstrap
    refute_nil initial_view
    assert bootstrap < initial_view,
           'the configurator deps must be injected before the first module render'
  end
end
