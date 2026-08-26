# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/ui/option_selector_controller'

class OptionSelectorControllerTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @controller = Granete::SketchUpExtension::UserInterface::OptionSelectorController.new(
      logger: @logger
    )
  end

  def test_show_selector_opens_dialog_and_sends_payload
    dialog = @controller.show_selector(
      role: 'FRENTES',
      role_name: 'Frentes',
      current_material_id: 'mat-01',
      allowed_materials: [{ 'id' => 'mat-01', 'name' => 'Roble' }],
      categories: [{ 'id' => 'cat-01', 'name' => 'Maderas' }]
    )

    refute_nil dialog
    assert @controller.open?
    assert_equal 'Catálogo de Acabados — Granete', dialog.properties[:dialog_title]
    assert_equal 960, dialog.properties[:width]
    assert_equal 620, dialog.properties[:height]

    # Trigger selector_ready callback
    dialog.callbacks.fetch('selector_ready').call(dialog)

    scripts = dialog.executed_scripts
    assert(scripts.any? { |s| s.include?('initOptionSelector') && s.include?('FRENTES') })
  end

  def test_handle_apply_invokes_on_apply_and_closes_dialog
    applied_result = nil
    dialog = @controller.show_selector(
      role: 'INTERIOR',
      role_name: 'Interiores',
      current_material_id: 'mat-white',
      allowed_materials: [{ 'id' => 'mat-white', 'name' => 'Blanco' }],
      categories: [],
      on_apply: lambda do |role, material_id, scope|
        applied_result = { role: role, material_id: material_id, scope: scope }
      end
    )

    assert @controller.open?

    # Trigger apply_selection callback
    payload = { 'role' => 'INTERIOR', 'materialId' => 'mat-white', 'scope' => 'project' }
    dialog.callbacks.fetch('apply_selection').call(dialog, JSON.generate(payload))

    refute_nil applied_result
    assert_equal 'INTERIOR', applied_result[:role]
    assert_equal 'mat-white', applied_result[:material_id]
    assert_equal 'project', applied_result[:scope]
    refute @controller.open?
  end

  def test_close_selector_closes_dialog
    dialog = @controller.show_selector(
      role: 'FRENTES',
      role_name: 'Frentes',
      current_material_id: nil,
      allowed_materials: [],
      categories: []
    )

    assert @controller.open?
    dialog.callbacks.fetch('close_selector').call(dialog)
    refute @controller.open?
  end
end
