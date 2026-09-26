# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.6: runs the real-JavaScript harness for
# granete-material-roles.js (the shared material/acabados authority under
# window.GraneteUI.materialRoles) and guards the structural contract of the
# extraction — the implementation lives in the external file, dialog.html
# loads it after the finish-selector module and before the inline bootstrap,
# the monolith never re-grows the material catalog/project-defaults/renderer
# code, Configurator + Finish Selector + Inspector consume the module API,
# GraneteDialog.setCatalog delegates the material slice and the GraneteState
# projection reads it, and the Ruby-native selector stays PRIMARY with the
# finish-selector modal as local fallback. Symbol-based, not line-count-based.
class GraneteMaterialRolesJsTest < Minitest::Test
  MATERIAL_ROLES_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-material-roles.js',
                                       __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_material_roles_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_material_roles_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_material_roles_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript material roles module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 30,
                    'material roles harness must keep covering registration/idempotence, ' \
                    'the minimal public API, catalog set/reset + refresh identity, project ' \
                    'defaults surviving refreshes, materialById lookups, curated/invalid/' \
                    'fallback option resolution, default choice resolution, role rendering ' \
                    '(visibility/swatch/meta), the Ruby-primary selector with the ' \
                    'finish-selector fallback, context payload resolution (configurator / ' \
                    'inspector / explicit), the project-default write path, signed media ' \
                    'through GraneteUI.media and the integrated orchestrator + GraneteState ' \
                    'projection single-authority semantics'
  end

  def test_implementation_lives_in_granete_material_roles_js_with_contract_header
    source = File.read(MATERIAL_ROLES_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.materialRoles ='
    # Single ownership of the material authority slice.
    assert_includes source, 'var catalogMaterialCategories = [];'
    assert_includes source, 'var catalogMaterials = [];'
    assert_includes source, 'var projectDefaultMaterials = {};'
    # Minimal public API: catalog + defaults + resolution + rendering.
    %w[init setCatalog getMaterials getMaterialCategories materialById optionMaterialIds
       defaultMaterialChoices renderMaterialSelectors updateMaterialSwatch
       setProjectDefaultMaterial].each do |entry|
      assert_includes source, entry, "public API entry #{entry} must exist"
    end
    # Media/Finish Selector boundaries stay namespaced consumers, never copies.
    assert_includes source, 'window.GraneteUI.media.filenameFromPath'
    assert_includes source, 'window.GraneteUI.media.resolveUrl'
    assert_includes source, 'window.GraneteUI.finishSelector.open'
    assert_includes source, 'deps.icon', 'the icon helper must be consumed injected'
    %w[getInspectorMaterialsCard getInspectorDef getSelectedContext].each do |dep|
      assert_includes source, "deps.#{dep}", "inspector context accessor #{dep} must be consumed injected"
    end
    # Agent-first contract header (#848 §22).
    assert_includes source, 'Owns:', 'granete-material-roles.js must open with its ownership header'
    assert_includes source, 'Does NOT own:'
    # The owner-approved contract clarification: projectDefaultMaterials is
    # session-local dialog state, never persisted project/backend truth.
    assert_includes source, 'session-local'
    assert_includes source, 'NOT backend business truth'
    refute_includes source, 'refresh_media_url', 'no media minting inside the material roles module'
  end

  def test_dialog_html_loads_material_roles_module_between_finish_selector_and_the_inline_script
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    finish_selector_tag = html.index('<script src="js/granete-finish-selector.js"></script>')
    material_roles_tag = html.index('<script src="js/granete-material-roles.js"></script>')
    inline_tag = html.index('<script>')
    refute_nil finish_selector_tag, 'dialog.html must load js/granete-finish-selector.js'
    refute_nil material_roles_tag, 'dialog.html must load js/granete-material-roles.js'
    refute_nil inline_tag, 'dialog.html must keep its inline bootstrap script'
    assert finish_selector_tag < material_roles_tag,
           'the material roles module loads after the finish selector module (dialog load order)'
    assert material_roles_tag < inline_tag,
           'the material roles module must be registered BEFORE the inline bootstrap wires its deps'
    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    assert_includes loader, 'js/granete-material-roles.js', 'harness loader must read the real module file'
    loader_fs = loader.index('sources.finishSelector,')
    loader_mr = loader.index('sources.materialRoles,')
    loader_inline = loader.index('sources.inline,')
    assert loader_fs && loader_mr && loader_inline, 'dialog_scripts.js must run the real module sources'
    assert loader_fs < loader_mr && loader_mr < loader_inline,
           'dialog_scripts.js must load finish-selector → material-roles → inline, in dialog order'
  end

  def test_dialog_html_no_longer_carries_the_material_roles_implementation
    # The monolith must not re-grow what Phase B extracted: only the
    # window.GraneteUI.materialRoles API calls and the bootstrap wiring may
    # remain inline.
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var catalogMaterials', 'var catalogMaterialCategories', 'var projectDefaultMaterials',
     'function materialById(', 'function optionMaterialIds(', 'function defaultMaterialChoices(',
     'function materialOptionLabel(', 'function updateMaterialSwatch(', 'function updateMaterialMeta(',
     'function renderMaterialSelectors('].each do |symbol|
      refute_includes html, symbol,
                      "material roles implementation symbol #{symbol} belongs in granete-material-roles.js"
    end
  end

  def test_set_catalog_delegates_the_material_slice_and_granete_state_reads_the_module
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    # GraneteDialog.setCatalog stays the Ruby-facing thin orchestrator: the
    # material slice (both the array reset and the object payload) delegates
    # to the module; hardware keeps its inline slice until its own Phase B
    # slice.
    assert_includes html, 'window.GraneteUI.materialRoles.setCatalog({ materials: [], categories: [] })'
    assert_includes html, 'window.GraneteUI.materialRoles.setCatalog({'
    assert_includes html, 'materials: payload.materials || [],'
    assert_includes html, 'categories: payload.materialCategories || []'
    assert_includes html, 'catalogHardware = payload.hardware || [];'
    # The GraneteState projection reads materials through the module API —
    # one material authority, no inline copy.
    assert_includes html, 'materials: window.GraneteUI.materialRoles.getMaterials(),'
  end

  def test_configurator_finish_selector_and_inspector_consume_the_material_roles_api
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    # Configurator injection (material helpers no longer inline).
    assert_includes html, 'defaultMaterialChoices: window.GraneteUI.materialRoles.defaultMaterialChoices,'
    assert_includes html, 'renderMaterialSelectors: window.GraneteUI.materialRoles.renderMaterialSelectors,'
    assert_includes html, 'materialById: window.GraneteUI.materialRoles.materialById,'
    assert_includes html, 'setProjectDefaultMaterial: window.GraneteUI.materialRoles.setProjectDefaultMaterial,'
    # Finish Selector injection.
    assert_includes html, 'getMaterialCategories: window.GraneteUI.materialRoles.getMaterialCategories,'
    assert_includes html, 'optionMaterialIds: window.GraneteUI.materialRoles.optionMaterialIds,'
    assert_includes html, 'updateMaterialSwatch: window.GraneteUI.materialRoles.updateMaterialSwatch,'
    # Inspector shared calls (rollback, onMaterialChoiceApplied, render).
    assert_equal 3, html.scan('window.GraneteUI.materialRoles.renderMaterialSelectors(inspectorMaterialsCard').length,
                 'all inspector render paths (rollback + choice-applied + render) go through the module'
    assert_includes html, 'window.GraneteUI.materialRoles.defaultMaterialChoices(inspectorDef)'
    assert_includes html, 'window.GraneteUI.materialRoles.defaultMaterialChoices(def)'
    assert_equal 3, html.scan('window.GraneteUI.materialRoles.setProjectDefaultMaterial(').length,
                 'project-default writes (inspector callbacks + onMaterialChoiceApplied) go through the module'
    # onMaterialChoiceApplied keeps its cross-domain routing inline (until
    # the Inspector slice); only its shared reads/writes migrated.
    assert_includes html, 'onMaterialChoiceApplied: function (payload) {'
    assert_includes html, 'window.GraneteUI.configurator.applyMaterialChoice(role, materialId, isProjectScope)'
    # Wiring order: materialRoles.init → configurator.init →
    # finishSelector.init → renderModelBindingStatus → dialog_ready.
    mr_init = html.index('window.GraneteUI.materialRoles.init({')
    config_init = html.index('window.GraneteUI.configurator.init({')
    fs_init = html.index('window.GraneteUI.finishSelector.init({')
    binding_render = html.index('renderModelBindingStatus({ state: "unbound" })')
    dialog_ready = html.index('window.sketchup.dialog_ready()')
    refute_nil mr_init
    refute_nil config_init
    refute_nil fs_init
    refute_nil binding_render
    refute_nil dialog_ready
    assert mr_init < config_init, 'materialRoles.init must run before configurator.init consumes its API'
    assert config_init < fs_init, 'configurator.init must run before finishSelector.init (bootstrap order)'
    assert fs_init < binding_render, 'module wiring must complete before the first render'
    assert binding_render < dialog_ready, 'wiring must complete before dialog_ready answers Ruby'
  end

  def test_ruby_native_selector_remains_primary_with_the_module_fallback
    source = File.read(MATERIAL_ROLES_JS, encoding: 'UTF-8')
    ruby_path = source.index('typeof window.sketchup.open_material_selector === "function"')
    fallback_path = source.index('window.GraneteUI.finishSelector.open(r, choices[r.role]')
    refute_nil ruby_path, 'the Ruby-native selector condition must live in the module'
    refute_nil fallback_path, 'the finish-selector fallback must live in the module'
    assert ruby_path < fallback_path, 'the Ruby-native selector stays the PRIMARY path'
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    refute_includes html, 'open_material_selector',
                    'the selector hand-off moved into the module; dialog.html keeps no copy'
  end
end
