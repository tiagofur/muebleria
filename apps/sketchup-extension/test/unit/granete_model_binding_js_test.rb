# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #848 Phase B C4.8: guards the structural contract of the model binding
# module — the Model ↔ Project/Design binding UI/state (#388), the pairing
# code entry (#499), the publish confirmation/orchestration (#392/#847) and
# the design-wide validation UX (#731) live in granete-model-binding.js
# with its Owns/Consumes/Does-NOT-own header; dialog.html keeps NO
# binding/publish/validation implementation symbols; the Ruby bridge names
# are unchanged and stay thin delegation; the connected-status fan-out
# (commercial contexts + Project Furniture reload) remains the inline
# onModelBindingStatus orchestrator; Project Furniture state (lastPfState)
# stays inline-owned until its own Phase B slice; the Configurator reads
# the connection through the module accessor. Symbol-based, not
# line-count-based.
class GraneteModelBindingJsTest < Minitest::Test
  MODEL_BINDING_JS = File.expand_path('../../src/granete_for_sketchup/resources/js/' \
                                      'granete-model-binding.js', __dir__)
  DIALOG_HTML = File.expand_path('../../src/granete_for_sketchup/resources/dialog.html', __dir__)
  DIALOG_SCRIPTS_LOADER = File.expand_path('../js/support/dialog_scripts.js', __dir__)

  def test_real_javascript_model_binding_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_model_binding_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_model_binding_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript model binding module test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 40,
                    'model binding harness must keep covering registration/idempotence, ' \
                    'the nine distinct binding states (copy + reason + base label), the PF ' \
                    'invalidation seam, the Configurator seam, manual bind/rebind/refresh/adopt, ' \
                    'the pairing flow, the publish confirmation (arm, confirm, cancel, Escape, ' \
                    '6s timer, double-click), the publish-gate view and the validation UX'
  end

  def test_model_binding_module_exists_with_ownership_header
    source = File.read(MODEL_BINDING_JS, encoding: 'UTF-8')
    assert_includes source, '#848 Phase B C4.8 — model binding module'
    assert_includes source, '// Owns:'
    assert_includes source, '// Consumes:'
    assert_includes source, '// Does NOT own:'
    # The binding/publish/validation responsibilities are named as THIS
    # module's ownership, with the temporary PF seam documented.
    assert_includes source, '#388'
    assert_includes source, '#499'
    assert_includes source, '#392'
    assert_includes source, '#731'
    assert_includes source, 'invalidateProjectFurniture'
  end

  def test_model_binding_module_owns_the_binding_publish_validation_surface
    source = File.read(MODEL_BINDING_JS, encoding: 'UTF-8')
    # State authority lives here.
    ['var MODEL_BINDING_COPY', 'var modelBindingState', 'var PUBLISH_STEP_COPY',
     'var PUBLISH_ERROR_COPY', 'var VALIDATION_STATE_LABELS', 'var publishInFlight',
     'var lastPublishOutcome', 'var publishArmed', 'var publishArmTimer',
     'var designValidateInFlight'].each do |symbol|
      assert_includes source, symbol, "granete-model-binding.js owns #{symbol}"
    end
    # The binding/pairing/publish/validation render paths live here.
    ['function bindingBaseLabel(', 'function renderModelBindingStatus(',
     'function fillSelect(', 'function designStatusLabel(',
     'function openBindingPicker(', 'function handleBindingProjects(',
     'function handleBindingDesigns(', 'function updateBindingConfirmState(',
     'function connectBindingModel(', 'function handleModelBindingResult(',
     'function refreshModelBinding(', 'function setPairingBusy(',
     'function showPairingMessage(', 'function submitPairingCode(',
     'function resetPublishConfirm(', 'function armPublishConfirm(',
     'function startPublishOrchestration(', 'function canPublish(',
     'function renderPublishAvailability(', 'function renderPublishProgress(',
     'function handlePublishResult(', 'function validationStateLabel(',
     'function renderDesignValidation(', 'function renderDesignValidationProgress(',
     'function handleDesignValidationResult(', 'function validationExceptionCard('].each do |symbol|
      assert_includes source, symbol, "granete-model-binding.js owns #{symbol}"
    end
    # Exact UX defenses preserved inside the module.
    assert_includes source, 'setTimeout(resetPublishConfirm, 6000)'
    assert_includes source, 'confirmRebind === true'
    assert_includes source, 'window.sketchup.connect_with_code(JSON.stringify({ code: code }))'
    assert_includes source, 'window.sketchup.publish_design_revision()'
    assert_includes source, 'window.sketchup.validate_design_revision()'
  end

  def test_dialog_no_longer_declares_or_implements_the_binding_domain
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['var modelBindingState', 'var MODEL_BINDING_COPY', 'var PUBLISH_STEP_COPY',
     'var PUBLISH_ERROR_COPY', 'var VALIDATION_STATE_LABELS', 'var publishInFlight',
     'var lastPublishOutcome', 'var publishArmed', 'var publishArmTimer',
     'var designValidateInFlight', 'function renderModelBindingStatus(',
     'function handleModelBindingResult(', 'function renderPublishProgress(',
     'function handlePublishResult(', 'function renderDesignValidationProgress(',
     'function handleDesignValidationResult(', 'function handleBindingProjects(',
     'function handleBindingDesigns(', 'function submitPairingCode(',
     'function resetPublishConfirm(', 'function openBindingPicker(',
     'function fillSelect('].each do |symbol|
      refute_includes html, symbol, "dialog.html must not carry binding implementation: #{symbol}"
    end
    # The binding DOM refs moved with the module.
    refute_includes html, 'var bindingBadge = document.getElementById'
    refute_includes html, 'var bindingPublishBtn = document.getElementById'
    refute_includes html, 'var pairingEntry = document.getElementById'
  end

  def test_dialog_loads_the_model_binding_module_between_inspector_and_the_inline_bootstrap
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    inspector = html.index('<script src="js/granete-inspector.js"></script>')
    model_binding = html.index('<script src="js/granete-model-binding.js"></script>')
    inline = html.index('<script>', inspector + 1)
    refute_nil inspector
    refute_nil model_binding
    refute_nil inline
    assert inspector < model_binding && model_binding < inline,
           'load order must be inspector → model-binding → inline bootstrap'

    loader = File.read(DIALOG_SCRIPTS_LOADER, encoding: 'UTF-8')
    loader_inspector = loader.index('sources.inspector,')
    loader_model_binding = loader.index('sources.modelBinding')
    loader_inline = loader.index('sources.inline')
    refute_nil loader_model_binding, 'the harness loader must run the REAL granete-model-binding.js'
    assert loader_inspector < loader_model_binding && loader_model_binding < loader_inline,
           'harness load order must mirror dialog.html'
  end

  def test_bootstrap_wires_the_module_and_delegates_the_initial_unbound_render
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    config_init = html.index('window.GraneteUI.configurator.init({')
    mb_init = html.index('window.GraneteUI.modelBinding.init({')
    finish_init = html.index('window.GraneteUI.finishSelector.init({')
    unbound = html.index('window.GraneteUI.modelBinding.setStatus({ state: "unbound" })')
    dialog_ready = html.index('window.sketchup.dialog_ready()')
    refute_nil mb_init
    refute_nil unbound
    assert mb_init < config_init, 'modelBinding.init must run before configurator.init consumes its accessor'
    assert config_init < finish_init, 'configurator.init must run before finishSelector.init'
    assert finish_init < unbound, 'module wiring must complete before the first status render'
    assert unbound < dialog_ready, 'wiring must complete before dialog_ready answers Ruby'
    # The initial unbound render delegates to the module; no inline helper.
    refute_includes html, 'renderModelBindingStatus({ state: "unbound" })'
    # The Configurator reads the connection through the module accessor.
    assert_includes html, 'isModelConnected: window.GraneteUI.modelBinding.isConnected,'
  end

  def test_ruby_facing_bridge_wrappers_stay_thin_delegation_with_unchanged_names
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    ['onModelBindingStatus: function (status) {',
     'onModelBindingResult: function (result) { window.GraneteUI.modelBinding.onResult(result); }',
     'onPublishProgress: function (payload) { window.GraneteUI.modelBinding.onPublishProgress(payload); }',
     'onPublishResult: function (result) { window.GraneteUI.modelBinding.onPublishResult(result); }',
     'onDesignValidationProgress: function (payload) { ' \
     'window.GraneteUI.modelBinding.onDesignValidationProgress(payload); }',
     'onDesignValidationResult: function (result) { ' \
     'window.GraneteUI.modelBinding.onDesignValidationResult(result); }',
     'onBindingProjects: function (result) { window.GraneteUI.modelBinding.onBindingProjects(result); }',
     'onBindingDesigns: function (result) { ' \
     'window.GraneteUI.modelBinding.onBindingDesigns(result); }'].each do |wrapper|
      assert_includes html, wrapper, "Ruby bridge wrapper must stay: #{wrapper}"
    end
    # The connected-status fan-out (commercial contexts + Project Furniture
    # reload) stays in the inline onModelBindingStatus orchestrator.
    orchestrator = html.index('window.GraneteUI.modelBinding.setStatus(status);')
    commercial = html.index('window.GraneteCommercialProjection.setBinding(status);')
    bootstrap_commercial = html.index('window.GraneteCommercialBootstrap.setBinding(status);')
    pf_reload = html.index('if (status && status.state === "connected") requestProjectFurniture();')
    refute_nil orchestrator
    refute_nil commercial
    refute_nil bootstrap_commercial
    refute_nil pf_reload
    assert orchestrator < commercial && commercial < bootstrap_commercial && bootstrap_commercial < pf_reload,
           'commercial fan-out + connected PF reload keep their inline orchestrator order'
  end

  def test_project_furniture_authority_stays_inline_until_its_own_slice
    html = File.read(DIALOG_HTML, encoding: 'UTF-8')
    source = File.read(MODEL_BINDING_JS, encoding: 'UTF-8')
    # lastPfState keeps its single inline owner; the module only receives
    # the invalidation seam through init.
    assert_includes html, 'var lastPfState = null;', 'Project Furniture owns lastPfState'
    refute_includes source, 'var lastPfState', 'the module must not copy PF state'
    assert_includes html,
                    'invalidateProjectFurniture: function () { lastPfState = null; }',
                    'the temporary C4.8 seam invalidates the inline-owned PF rows'
    assert_includes source, 'deps.invalidateProjectFurniture();',
                    'every status render invalidates through the seam'
  end
end
