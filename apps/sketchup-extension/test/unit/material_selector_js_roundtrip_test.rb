# frozen_string_literal: true

require 'json'
require 'open3'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'

class MaterialSelectorJsRoundtripTest < Minitest::Test
  def test_real_javascript_material_selector_harness_executes_and_passes
    js_test_path = File.expand_path('../js/material_selector_roundtrip_test.js', __dir__)
    assert File.exist?(js_test_path), 'material_selector_roundtrip_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript roundtrip test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 5

    applied = result['appliedPayload']
    assert_equal 'FRENTES', applied['role']
    assert_equal 'mat-02', applied['materialId']
    assert_equal 'project', applied['scope']
    assert_equal 'inst-kitchen-base-01', applied.dig('context', 'instanceId')
  end

  def test_full_ruby_to_js_roundtrip_payload_coordination
    logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    controller = Granete::SketchUpExtension::UserInterface::OptionSelectorController.new(
      logger: logger
    )

    received_apply = nil
    dialog = controller.show_selector(
      role: 'FRENTES',
      role_name: 'Frentes',
      current_material_id: 'mat-01',
      allowed_materials: [
        { 'materialId' => 'mat-01', 'name' => 'Roble' },
        { 'materialId' => 'mat-02', 'name' => 'Blanco' }
      ],
      categories: [{ 'id' => 'cat-1', 'name' => 'Maderas' }],
      on_apply: lambda do |role, material_id, scope, context|
        received_apply = {
          role: role,
          material_id: material_id,
          scope: scope,
          context: context
        }
      end
    )

    # 1. Dialog opens and JS triggers selector_ready
    dialog.callbacks.fetch('selector_ready').call(dialog)
    init_script = dialog.executed_scripts.find { |s| s.include?('initOptionSelector') }
    refute_nil init_script, 'Ruby must inject initOptionSelector script into HtmlDialog'

    # 2. JS executes, user clicks and JS triggers apply_selection callback
    js_payload = {
      'role' => 'FRENTES',
      'materialId' => 'mat-02',
      'scope' => 'project',
      'context' => {
        'source' => 'inspector',
        'instanceId' => 'inst-kitchen-base-01',
        'definitionId' => 'kitchen-base-standard'
      }
    }
    dialog.callbacks.fetch('apply_selection').call(dialog, JSON.generate(js_payload))

    # 3. Ruby callback receives exact arguments
    refute_nil received_apply
    assert_equal 'FRENTES', received_apply[:role]
    assert_equal 'mat-02', received_apply[:material_id]
    assert_equal 'project', received_apply[:scope]
    assert_equal 'inst-kitchen-base-01', received_apply.dig(:context, 'instanceId')
    refute controller.open?, 'Dialog must close after apply'
  end
end
