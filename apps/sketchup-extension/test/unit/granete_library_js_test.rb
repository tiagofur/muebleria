# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.3: runs the real-JavaScript harness for granete-library.js
# (the library browser module under window.GraneteUI) and guards the
# structural contract of the extraction — the implementation lives in the
# external file, dialog.html loads it after the account module and before
# the inline bootstrap, GraneteDialog.setCatalog stays the Ruby-facing thin
# orchestrator delegating the browsing slice to the module, and the
# monolith never re-grows the library code or a second definitions
# authority. Symbol-based, not line-count-based.
class GraneteLibraryJsTest < Minitest::Test
  LIBRARY_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/granete-library.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)

  def test_real_javascript_library_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_library_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_library_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript library module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 25,
                    'library harness must keep covering registration, visual states ' \
                    '(loading/empty/unauthenticated/error/license), category cascade with ' \
                    'subtree filtering, search, cards, media delegation, the selection ' \
                    'hand-off and the single definitions authority'
  end

  def test_library_implementation_lives_in_granete_library_js_with_contract_header
    source = File.read(LIBRARY_JS, encoding: 'UTF-8')
    assert_includes source, 'window.GraneteUI.library ='
    # Single ownership of the catalog browsing slice.
    assert_includes source, 'var catalog = [];'
    assert_includes source, 'var catalogCategories = [];'
    assert_includes source, 'var catalogSource = "loading";'
    assert_includes source, 'var licenseBlocked = false;'
    assert_includes source, 'var searchQuery = "";'
    assert_includes source, 'var selectedCategory = "ALL";'
    # Explicit injected dependencies — no duplicated inline helpers.
    assert_includes source, 'deps.icon'
    assert_includes source, 'deps.createFurniturePlaceholderSvg'
    assert_includes source, 'deps.onSelectDefinition'
    assert_includes source, 'deps.getSelectedDefinitionId'
    # Media/account boundaries stay namespaced consumers, never copies.
    assert_includes source, 'window.GraneteUI.media.filenameFromPath'
    assert_includes source, 'window.GraneteUI.account.open()'
    assert_includes source, 'window.sketchup.get_catalog'
    # Agent-first contract header (#848 §10).
    assert_includes source, 'Owns:', 'granete-library.js must open with its ownership header'
    assert_includes source, 'Does NOT own:'
  end

  def test_dialog_html_loads_library_module_between_account_and_the_inline_script
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    media_tag = html.index('<script src="js/granete-media.js"></script>')
    account_tag = html.index('<script src="js/granete-account.js"></script>')
    library_tag = html.index('<script src="js/granete-library.js"></script>')
    inline_tag = html.index('<script>')
    refute_nil media_tag, 'dialog.html must load js/granete-media.js'
    refute_nil account_tag, 'dialog.html must load js/granete-account.js'
    refute_nil library_tag, 'dialog.html must load js/granete-library.js'
    refute_nil inline_tag, 'dialog.html must keep its inline bootstrap script'
    assert account_tag < library_tag,
           'the library module loads after the account module (dialog load order)'
    assert library_tag < inline_tag,
           'the library module must be ready BEFORE the inline bootstrap renders and answers dialog_ready'
  end

  def test_dialog_html_no_longer_carries_the_library_implementation
    # The monolith must not re-grow what Phase B extracted: only the
    # window.GraneteUI.library API calls and the thin GraneteDialog
    # orchestration may remain inline.
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var catalog =', 'var catalogCategories', 'var catalogSource', 'var licenseBlocked',
     'var searchQuery', 'var selectedCategory', 'var categoryNodeById', 'var categoryChildren',
     'var CATEGORY_LABELS', 'function formatCategoryLabel', 'function renderLibraryState',
     'function buildCategoryIndex', 'function subtreeCategoryIds', 'function countModulesInSubtree',
     'function categoryPathIdsOf', 'function appendCategoryOption', 'function fillCascadeLevel',
     'function renderCategoryFilters', 'function renderFurnitureCards', 'function renderLibraryBrowser',
     'function catalogSourceNote', 'function getDefinitionDefaultDims'].each do |symbol|
      refute_includes html, symbol,
                      "library implementation symbol #{symbol} belongs in granete-library.js"
    end
  end

  def test_granete_dialog_set_catalog_stays_the_thin_orchestrator
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    # Ruby keeps calling GraneteDialog.setCatalog with the same payload; the
    # browsing slice delegates to the module, presets delegate to the
    # configurator module (#848 C4.4), and the not-yet-extracted slices
    # (materials/hardware/media/GraneteState) stay here.
    assert_includes html, 'setCatalog: function'
    assert_includes html, 'window.GraneteUI.library.setCatalog(payload)'
    assert_includes html, 'window.GraneteUI.configurator.setPresets(payload.presets || []);'
    assert_includes html, 'catalogMaterials = payload.materials || [];'
    assert_includes html, 'catalogHardware = payload.hardware || [];'
    assert_includes html, 'window.GraneteUI.media.setCatalogMedia(payload.media)'
    # The GraneteState projection reads through the module API — one
    # definitions authority, no inline copy.
    assert_includes html, 'definitions: window.GraneteUI.library.getDefinitions(),'
    assert_includes html, 'categories: window.GraneteUI.library.getCategories()'
    # External consumers migrated to explicit reads.
    assert_includes html, 'window.GraneteUI.library.findDefinitionById('
    # The bootstrap wires the shared helpers and the configurator hand-off
    # (call-time resolution through the configurator module, #848 C4.4)
    # before the first render; the browser render itself is driven by the
    # configurator's view transition (granete-configurator.js).
    assert_includes html, 'window.GraneteUI.library.init({'
    assert_includes html, 'onSelectDefinition: function (def) {'
    assert_includes html, 'window.GraneteUI.configurator.open(def);'
    assert_includes html, 'window.GraneteUI.configurator.close();'
    configurator_js = File.read(
      File.expand_path('../../src/granete_for_sketchup/resources/js/granete-configurator.js', __dir__),
      encoding: 'UTF-8'
    )
    assert_includes configurator_js, 'window.GraneteUI.library.render()'
  end
end
