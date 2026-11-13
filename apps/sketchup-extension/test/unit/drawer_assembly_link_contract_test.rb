# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/door_actors'

# #1468 boundary regression: the drawer assembly link MUST survive the whole
# transport chain — server layout JSON → LayoutContract.parse! → FurnitureBuilder
# child metadata → DoorActors.scan. The unit tests of #1465/#1467 injected
# child metadata straight into the store, which hid TWO breaks:
#   (a) parse_board discarded components[].assemblyInstanceId and
#       render_native_layout never passed it, so the drawer box board reached
#       the model WITHOUT its assembly link (box never joined the drawer);
#   (b) LayoutAssemblyRigidMember#initialize omitted actor_membership on
#       super(), letting LayoutHardwarePlacement nullify it — rails never
#       carried their membership.
# This test feeds a REAL layout body through the public parse!/insert_furniture
# path, the way the live host does.
class DrawerAssemblyLinkContractTest < Minitest::Test
  ASM_ID = 'd82e52f4-9859-4e45-b459-6f80ad27324a'
  AGR_ID = '72e3d65f-4734-4a2e-8dee-88324f51477f'
  IDENTITY_BASIS = { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }.freeze

  # Shape mirrors the real resolved layout of MOD-BAJ-3CAJ: drawer box boards
  # travel as top-level components WITH the assembly link the engine seals
  # (#1465), rails travel in assemblies[].rigidMembers with explicit
  # actorMembership, module structure boards carry no link.
  LAYOUT_BODY = {
    'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
    'definitionName' => 'Gabinete Bajo 3 Cajones',
    'transformContract' => 'granete.local-basis.v1',
    'dimensionsMm' => [600, 720, 500],
    'components' => [
      { 'componentInstanceId' => 'st-costado', 'slotId' => 'lateral_izquierdo',
        'role' => 'LATERAL', 'name' => 'Costado',
        'widthMm' => 560, 'thicknessMm' => 18, 'lengthMm' => 684,
        'localTransform' => { 'translationMm' => [0, 0, 0], 'basis' => IDENTITY_BASIS } },
      { 'componentInstanceId' => 'agr-cajon-u0-lat-copy-0',
        'slotId' => 'lateral_izquierdo', 'role' => 'INTERIOR', 'name' => 'Lateral Cajon',
        'assemblyInstanceId' => ASM_ID,
        'widthMm' => 450, 'thicknessMm' => 15, 'lengthMm' => 500,
        'localTransform' => { 'translationMm' => [13, 90, 30], 'basis' => IDENTITY_BASIS } },
      { 'componentInstanceId' => 'agr-frente-u0', 'slotId' => 'frente_cajon',
        'role' => 'FRENTE', 'name' => 'Frente Cajon',
        'widthMm' => 564, 'thicknessMm' => 18, 'lengthMm' => 150,
        'localTransform' => { 'translationMm' => [0, 500, 30], 'basis' => IDENTITY_BASIS } }
    ],
    'assemblies' => [
      { 'assemblyInstanceId' => ASM_ID, 'agregadoId' => AGR_ID,
        'placement' => { 'translationMm' => [0, 0, 0], 'basis' => IDENTITY_BASIS },
        'rigidMembers' => [
          { 'memberId' => 'fixed_rail_left', 'name' => 'fixed_rail_left',
            'actorMembership' => 'body', 'dimensionsMm' => [12, 500, 45],
            'localTransform' => { 'translationMm' => [10, 0, 0], 'basis' => IDENTITY_BASIS } },
          { 'memberId' => 'moving_rail_left', 'name' => 'moving_rail_left',
            'actorMembership' => 'actor:drawer', 'dimensionsMm' => [12, 450, 45],
            'localTransform' => { 'translationMm' => [35, 0, 0], 'basis' => IDENTITY_BASIS } }
        ] }
    ]
  }.freeze

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
  end

  def test_parse_retains_board_assembly_link_and_rail_membership
    layout = parsed_layout

    box = layout.boards.find { |b| b.component_instance_id == 'agr-cajon-u0-lat-copy-0' }
    refute_nil box, 'el board de la caja debe venir en components[]'
    assert_equal ASM_ID, box.assembly_instance_id,
                 'components[].assemblyInstanceId debe sobrevivir el parseo (vínculo caja↔ensamble, #1465 lado plugin)'

    structure = layout.boards.find { |b| b.component_instance_id == 'st-costado' }
    refute_nil structure
    assert_nil structure.assembly_instance_id, 'board de estructura sin vínculo'

    assembly = layout.assemblies.find { |a| a.assembly_instance_id == ASM_ID }
    refute_nil assembly
    moving = assembly.rigid_members.find { |m| m.member_id == 'moving_rail_left' }
    assert_equal 'actor:drawer', moving.actor_membership,
                 'actorMembership del miembro debe sobrevivir super() (#1468 causa A)'
    fixed = assembly.rigid_members.find { |m| m.member_id == 'fixed_rail_left' }
    assert_equal 'body', fixed.actor_membership
  end

  def test_builder_metadata_and_scan_group_front_box_and_rails
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed_layout)

    furniture = @model.active_entities.instances.first
    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.drawers.length, 'un cajón: frente + caja + riel móvil'
    drawer = scanned.drawers.first
    names = drawer.components.map(&:name)
    assert_includes names, 'Frente Cajon'
    assert_includes names, 'Lateral Cajon',
                    'la caja MDF viaja con el cajón (assemblyInstanceId estampado por el builder)'
    refute_includes names, 'Costado', 'la estructura del mueble nunca entra al cajón'
    hardware_names = drawer.hardware.map(&:name)
    assert_includes hardware_names, 'moving_rail_left'
    refute_includes hardware_names, 'fixed_rail_left', 'el riel fijo (body) queda en el mueble'
  end

  # #1613: el ensamble del accesorio elegido (#1555, `<bayId>-acc-<group>`)
  # es un ADJUNTO del cajón de su bahía — sus tiras viajan con el actor del
  # cajón base. Agruparlas bajo su propio assemblyInstanceId emitía un
  # «Cajón» fantasma (grupo con herrajes sin frente no es inerte por la
  # compuerta #1573) y desalineaba el emparejamiento frente↔caja.
  def test_accessory_assembly_rides_the_bay_drawer_not_a_phantom
    acc_asm = "#{ASM_ID}-acc-mbox_iridium_gray_e_inserto"
    layout_body = {
      'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
      'definitionName' => 'Gabinete con accesorio',
      'transformContract' => 'granete.local-basis.v1',
      'dimensionsMm' => [600, 720, 500],
      'components' => [
        { 'componentInstanceId' => 'agr-frente-u0', 'slotId' => 'frente_cajon',
          'role' => 'FRENTE', 'name' => 'Frente Cajon',
          'assemblyInstanceId' => ASM_ID,
          'widthMm' => 564, 'thicknessMm' => 18, 'lengthMm' => 150,
          'localTransform' => { 'translationMm' => [0, 500, 30], 'basis' => IDENTITY_BASIS } },
        { 'componentInstanceId' => 'agr-cajon-u0-lat-copy-0',
          'slotId' => 'lateral_izquierdo', 'role' => 'INTERIOR', 'name' => 'Lateral Cajon',
          'assemblyInstanceId' => ASM_ID,
          'widthMm' => 450, 'thicknessMm' => 15, 'lengthMm' => 500,
          'localTransform' => { 'translationMm' => [13, 90, 30], 'basis' => IDENTITY_BASIS } }
      ],
      'assemblies' => [
        { 'assemblyInstanceId' => ASM_ID, 'agregadoId' => AGR_ID,
          'placement' => { 'translationMm' => [0, 0, 0], 'basis' => IDENTITY_BASIS },
          'rigidMembers' => [
            { 'memberId' => 'moving_rail_left', 'name' => 'moving_rail_left',
              'actorMembership' => 'actor:drawer', 'dimensionsMm' => [12, 450, 45],
              'localTransform' => { 'translationMm' => [35, 0, 0], 'basis' => IDENTITY_BASIS } }
          ] },
        { 'assemblyInstanceId' => acc_asm, 'agregadoId' => AGR_ID,
          'placement' => { 'translationMm' => [0, 0, 0], 'basis' => IDENTITY_BASIS },
          'rigidMembers' => [
            { 'memberId' => 'galeria_left', 'name' => 'galeria_left',
              'actorMembership' => 'actor:drawer', 'dimensionsMm' => [14, 450, 110],
              'localTransform' => { 'translationMm' => [10, 0, 40], 'basis' => IDENTITY_BASIS } },
            { 'memberId' => 'galeria_right', 'name' => 'galeria_right',
              'actorMembership' => 'actor:drawer', 'dimensionsMm' => [14, 450, 110],
              'localTransform' => { 'translationMm' => [540, 0, 40], 'basis' => IDENTITY_BASIS } }
          ] }
      ]
    }

    layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(
      JSON.parse(JSON.generate(layout_body))
    )
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition, {}, resolved_layout: layout)

    furniture = @model.active_entities.instances.first
    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.drawers.length,
                 'las tiras del accesorio viajan con el cajón de la bahía — sin Cajón fantasma'
    hardware_names = scanned.drawers.first.hardware.map(&:name)
    assert_includes hardware_names, 'galeria_left',
                    'la tira del accesorio elegido viaja en el hardware del cajón base'
    assert_includes hardware_names, 'galeria_right'
  end

  private

  def parsed_layout
    Granete::SketchUpExtension::Library::LayoutContract.parse!(
      JSON.parse(JSON.generate(LAYOUT_BODY))
    )
  end
end
