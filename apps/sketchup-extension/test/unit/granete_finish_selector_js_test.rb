# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.5: runs the real-JavaScript harness for
# granete-finish-selector.js (the visual material picker modal under
# window.GraneteUI.finishSelector) and guards the structural contract of
# the extraction — the implementation lives in the external file,
# dialog.html loads it after the configurator module and before the
# inline bootstrap, the monolith never re-grows the modal code, and the
# finish selector reads the material authority through the injected deps
# (owned by window.GraneteUI.materialRoles since #848 C4.6). The
# Ruby-primary/local-fallback split of the selector hand-off is guarded
# by granete_material_roles_js_test.rb. Symbol-based, not line-count-based.
class GraneteFinishSelectorJsTest < Minitest::Test
  FINISH_SELECTOR_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-finish-selector.js',
                                        __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_finish_selector_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_finish_selector_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_finish_selector_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript finish selector module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 30,
                    'finish selector harness must keep covering registration/idempotence, ' \
                    'the init dependency contract, modal lifecycle + focus restore, context ' \
                    'copy, category navigation/auto-expand/subtree filtering, role-allowed ' \
                    'candidates, search (name/code/manufacturer + clear), empty states, ' \
                    'candidate count/click/double-click, detail rendering, breadcrumb ' \
                    'navigation, scope passthrough, Apply/Cancel, Escape/Enter keyboard ' \
                    'rules and the Tab/Shift+Tab focus trap'
  end

  def test_implementation_lives_in_granete_finish_selector_js_with_contract_header
    source = File.read(FINISH_SELECTOR_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.finishSelector ='
    # Single ownership of the modal state slice.
    assert_includes source, 'var selectorCtx = null;'
    assert_includes source, 'var selectorLastFocus = null;'
    # The public API stays minimal: open/close delegate to the moved
    # functions; the onApply callback keeps living inside selectorCtx.
    assert_includes source, 'open: openMaterialSelector,'
    assert_includes source, 'close: closeMaterialSelector'
    # Explicit injected dependencies — no duplicated catalog state or
    # shared helpers (Material Roles slice decides their final owner).
    %w[getMaterialCategories materialById optionMaterialIds updateMaterialSwatch
       icon].each do |dep|
      assert_includes source, "deps.#{dep}", "dependency #{dep} must be consumed injected"
    end
    # Agent-first contract header (#848 §10).
    assert_includes source, 'Owns:', 'granete-finish-selector.js must open with its ownership header'
    assert_includes source, 'Does NOT own:'
    # NO second material catalog authority inside the module.
    refute_includes source, 'var catalogMaterials',
                    'the module must read materials through the injected materialById, never a copy'
    refute_includes source, 'var catalogMaterialCategories',
                    'the module must read categories through getMaterialCategories, never a copy'
    # The shared swatch renderer / resolver stay single-implementation.
    ['function updateMaterialSwatch(', 'function materialById(', 'function optionMaterialIds('].each do |symbol|
      refute_includes source, symbol, "shared helper #{symbol} must stay injected, not duplicated"
    end
  end

  def test_dialog_html_loads_finish_selector_between_configurator_and_the_inline_script
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    configurator_tag = html.index('<script src="js/granete-configurator.js"></script>')
    finish_selector_tag = html.index('<script src="js/granete-finish-selector.js"></script>')
    inline_tag = html.index('<script>')
    refute_nil configurator_tag, 'dialog.html must load js/granete-configurator.js'
    refute_nil finish_selector_tag, 'dialog.html must load js/granete-finish-selector.js'
    refute_nil inline_tag, 'dialog.html must keep its inline bootstrap script'
    assert configurator_tag < finish_selector_tag,
           'the finish selector module loads after the configurator module (dialog load order)'
    assert finish_selector_tag < inline_tag,
           'the finish selector module must be registered BEFORE the inline bootstrap wires its deps'
    # The shared harness loader mirrors the dialog order.
    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    assert_includes loader,
                    "finishSelector: fs.readFileSync(path.join(RESOURCES, 'js/granete-finish-selector.js'), 'utf8')"
    assert(loader.index('granete-configurator.js') < loader.index('granete-finish-selector.js'),
           'dialog_scripts.js must execute the configurator before the finish selector')
    assert(loader.index('granete-finish-selector.js') < loader.index('dialog-inline.js'),
           'dialog_scripts.js must execute the finish selector before the inline bootstrap')
  end

  def test_dialog_html_no_longer_carries_the_modal_implementation
    # The monolith must not re-grow what Phase B extracted: only the
    # window.GraneteUI.finishSelector API call (the local fallback inside
    # renderMaterialSelectors) and the modal MARKUP may remain.
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var selectorCtx', 'var selectorLastFocus', 'var selectorModal =', 'var selectorCandidateGrid =',
     'var selectorDetailSwatch =', 'function openMaterialSelector(', 'function closeMaterialSelector(',
     'function renderSelectorNavigation(', 'function renderBreadcrumbs(', 'function appendSelectorColumnItem(',
     'function renderMillerColumns(', 'function getFilteredSelectorMaterials(', 'function renderSelectorGrid(',
     'function updateSelectorDetail(', 'function applySelectorChoice(', 'function findMaterialCategoryById(',
     'function getCategoryPathNodes(', 'function isMaterialInSubtree(', 'function countMaterialsInSubtree(',
     'typeof openMaterialSelector === "function"'].each do |symbol|
      refute_includes html, symbol,
                      "finish selector implementation symbol #{symbol} belongs in granete-finish-selector.js"
    end
    # The modal markup stays in dialog.html (it is chrome, not module code).
    assert_includes html, 'id="material-selector-modal"'
    assert_includes html, 'name="selector-scope"'
  end

  def test_material_catalog_authority_stays_single_and_finish_selector_reads_through_the_module
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    # ONE catalog authority since #848 C4.6: the catalog state and the
    # shared material helpers moved to window.GraneteUI.materialRoles; the
    # monolith keeps no copy.
    ['var catalogMaterialCategories = [];', 'var catalogMaterials = [];',
     'var projectDefaultMaterials = {}'].each do |symbol|
      refute_includes html, symbol, "material state #{symbol} belongs in granete-material-roles.js"
    end
    # The finish selector wiring reads the materialRoles authority — never
    # a second inline copy.
    assert_includes html, 'getMaterialCategories: window.GraneteUI.materialRoles.getMaterialCategories,'
  end

  def test_bootstrap_injects_the_dependencies_before_any_user_accessible_open
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    assert_includes html, 'window.GraneteUI.finishSelector.init({'
    # The five deps come from the materialRoles authority (#848 C4.6).
    assert_includes html, 'getMaterialCategories: window.GraneteUI.materialRoles.getMaterialCategories,'
    assert_includes html, 'materialById: window.GraneteUI.materialRoles.materialById,'
    assert_includes html, 'optionMaterialIds: window.GraneteUI.materialRoles.optionMaterialIds,'
    assert_includes html, 'updateMaterialSwatch: window.GraneteUI.materialRoles.updateMaterialSwatch,'
    assert_includes html, 'icon: icon'
    wiring = html.index('window.GraneteUI.finishSelector.init({')
    dialog_ready = html.index('window.sketchup.dialog_ready()')
    refute_nil wiring
    refute_nil dialog_ready
    assert wiring < dialog_ready,
           'finishSelector.init must run before dialog_ready answers Ruby'
  end
end
