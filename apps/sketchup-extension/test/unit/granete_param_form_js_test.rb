# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 post-C4.9: guards the structural contract of the shared
# parameter-form module — the final architectural extraction approved by
# the owner (Option B of the post-C4.9 audit). getDefaultParams,
# renderParamForm, parameterIssueMessage and estimatedPartsLabel live in
# granete-param-form.js with the Owns/Consumes/Does-NOT-own header; the
# module is stateless (no init, no injected dependency bag, no module
# state, no Ruby
# bridge, no chrome/capability helpers, no configurator/inspector state);
# dialog.html keeps NO parametric implementation symbols and wires both
# consumer init bags (configurator + inspector) to window.GraneteUI.paramForm.*;
# the load order matches between dialog.html and the dialog_scripts.js
# harness loader. Symbol-based, not line-count-based.
class GraneteParamFormJsTest < Minitest::Test
  PARAM_FORM_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/' \
                                   'granete-param-form.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_param_form_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_param_form_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_param_form_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript param form module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 20,
                    'param form harness must keep covering registration/idempotence, ' \
                    'the exact 4-entry public API, statelessness (no init/deps/state), ' \
                    'getDefaultParams, every renderParamForm control type with the ' \
                    'onChange contract, parameterIssueMessage exact copy/branching and ' \
                    'the estimatedPartsLabel honesty semantics (#847)'
  end

  def test_param_form_module_exists_with_ownership_header
    source = File.read(PARAM_FORM_JS, encoding: 'UTF-8')
    assert_includes source, '#848 post-C4.9 — shared parameter-form module'
    assert_includes source, '// Owns:'
    assert_includes source, '// Consumes:'
    assert_includes source, '// Does NOT own:'
    assert_includes source, 'State authority: none'
    assert_includes source, 'Start here when:'
    assert_includes source, '#847'
    # Focused-bug-entry guidance: a future agent lands here first.
    assert_includes source, 'granete_param_form_test.js'
  end

  def test_param_form_module_owns_the_shared_parameter_form_implementation
    source = File.read(PARAM_FORM_JS, encoding: 'UTF-8')
    # The four functions moved verbatim (single implementation).
    ['function getDefaultParams(def) {', 'function renderParamForm(container, def, currentValues, onChange) {',
     'function parameterIssueMessage(result, fallback) {',
     'function estimatedPartsLabel(def, currentValues) {',
     'window.GraneteUI.paramForm = {'].each do |symbol|
      assert_includes source, symbol, "granete-param-form.js owns #{symbol}"
    end
    # Stateless module: idempotent guard, no init, no injected dependency bag.
    assert_includes source, 'if (window.GraneteUI.paramForm) return;'
    refute_includes source, 'init: function', 'the module is init-free by contract'
    refute_includes source, 'requireDeps', 'the module takes no dep bag'
    # Exact historical semantics preserved inside the module.
    ['estimatedPartCount', 'estimatedHardwareCount', '"Aprox. "', 'Piezas: se calculan al resolver',
     'Completá el parámetro requerido', 'La definición tiene consumidores paramétricos en conflicto',
     'Máximo ', 'param-checkbox', 'param-value-badge', 'dim-input', 'stepper-value',
     'onChange(p.name, v, p.unit)'].each do |symbol|
      assert_includes source, symbol
    end
  end

  def test_dialog_no_longer_declares_or_implements_the_parameter_form
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['function getDefaultParams(', 'function renderParamForm(',
     'function parameterIssueMessage(', 'function estimatedPartsLabel(',
     'var PARAMETER_LABELS'].each do |symbol|
      refute_includes html, symbol, "dialog.html must not carry the parametric implementation: #{symbol}"
    end
    # The pre-extraction wiring style (bare inline identifiers) must not
    # regrow: the bootstrap consumes the module API only.
    refute_includes html, 'getDefaultParams: getDefaultParams'
    refute_includes html, 'renderParamForm: renderParamForm'
    refute_includes html, 'estimatedPartsLabel: estimatedPartsLabel'
    refute_includes html, 'parameterIssueMessage: parameterIssueMessage'
  end

  def test_dialog_loads_the_param_form_module_last_before_the_inline_bootstrap
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    project_furniture = html.index('<script src="js/granete-project-furniture.js"></script>')
    param_form = html.index('<script src="js/granete-param-form.js"></script>')
    inline = html.index('<script>', param_form + 1)
    refute_nil project_furniture
    refute_nil param_form
    refute_nil inline
    assert project_furniture < param_form && param_form < inline,
           'load order must be project-furniture → param-form → inline bootstrap'

    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    loader_project_furniture = loader.index('sources.projectFurniture')
    loader_param_form = loader.index('sources.paramForm')
    loader_inline = loader.index('sources.inline')
    refute_nil loader_param_form, 'the harness loader must run the REAL granete-param-form.js'
    assert loader_project_furniture < loader_param_form && loader_param_form < loader_inline,
           'harness load order must mirror dialog.html'
  end

  def test_bootstrap_wires_param_form_into_both_consumer_init_bags
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['getDefaultParams: window.GraneteUI.paramForm.getDefaultParams,',
     'renderParamForm: window.GraneteUI.paramForm.renderParamForm,',
     'estimatedPartsLabel: window.GraneteUI.paramForm.estimatedPartsLabel,',
     'parameterIssueMessage: window.GraneteUI.paramForm.parameterIssueMessage,'].each do |wiring|
      assert_equal 2, html.scan(wiring).size,
                   "both the configurator and the inspector init bags must consume the module: #{wiring}"
    end
    # The wiring happens in the bootstrap before dialog_ready answers Ruby.
    config_init = html.index('window.GraneteUI.configurator.init({')
    inspector_init = html.index('window.GraneteUI.inspector.init({')
    dialog_ready = html.index('window.sketchup.dialog_ready()')
    refute_nil config_init
    refute_nil inspector_init
    refute_nil dialog_ready
    assert inspector_init < config_init && config_init < dialog_ready,
           'param-form consumers must be wired before dialog_ready'
  end

  def test_param_form_module_stays_free_of_foreign_responsibilities
    source = File.read(PARAM_FORM_JS, encoding: 'UTF-8')
    code_only = source.gsub(%r{//[^\n]*}, '')
    # No chrome/capability/toast/tab logic and no bridge surface.
    ['ICON_PATHS', 'createFurniturePlaceholderSvg', 'showToast', 'switchTab', 'capabilityEnabled',
     'GraneteDialog', 'window.sketchup', 'document.getElementById', 'setTimeout'].each do |symbol|
      refute_includes code_only, symbol, "granete-param-form.js must not acquire #{symbol}"
    end
    # No configurator/inspector state ownership (consumers stay call-side).
    ['var activeLibDef', 'var libParams', 'var selectedContext', 'var inspectorDef',
     'var inspectorParams', 'var lastPfState', 'deps.'].each do |symbol|
      refute_includes code_only, symbol, "granete-param-form.js must not own foreign state: #{symbol}"
    end
  end
end
