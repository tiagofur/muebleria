# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/selection/door_actors'

# #1377 legacy-layout regression: the Go engine emits agregado-expanded drawer
# box boards as TOP-LEVEL components WITHOUT assemblyInstanceId, embedding the
# assembly instance id inside the board's own componentInstanceId
# (`agr-<agrId>-instance-<asmId>-u<idx>-…`). The scanner must pair each box
# board with the rail group whose assemblyInstanceId appears in its id, keep
# cabinet structure boards (`st-…` ids) out, and treat rails without explicit
# membership as best-effort drawer hardware (legacy metadata) while explicit
# 'body' rails stay fixed.
#
# Metadata shape mirrors EXACTLY what ChildMetadataWriter.write_part /
# write_hardware persist in the real host.
#
# #1468: this test travelled in the #1450 review round 2 commit (0eaea903)
# that never reached main — the squash merge ran 39 minutes before the push.
class DrawerActorsLegacyMetadataTest < Minitest::Test
  NS = 'com.granete.sketchup_extension'
  ASM_1 = 'd82e52f4-9859-4e45-b459-6f80ad27324a'
  ASM_2 = '730a4719-16e1-4db7-8279-ec3b9c331ced'

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
  end

  def test_legacy_metadata_groups_front_box_and_rails_per_drawer
    furniture = build_furniture do |definition|
      # Estructura del mueble (ids st-…, sin assemblyInstanceId)
      structure_board(definition, 'st-costado')
      # Cajón 1: caja sin assemblyInstanceId (legacy) + rieles legacy sin membership.
      # z realistas en TODAS las piezas (#1467 lección): un riel en z=0 colapsa
      # el min_z del grupo y el emparejado frontal pasa a depender del
      # tie-break alfabético — exactamente el cruce que #1466 cazó en vivo.
      front_board(definition, 'agr-front-1', z_mm: 2.0)
      box_board(definition, "agr-49402645-instance-#{ASM_1}-u0-lat-copy-0", z_mm: 30.0)
      box_board(definition, "agr-49402645-instance-#{ASM_1}-u0-fondo-copy-0", z_mm: 30.0)
      rail_hardware(definition, "rail-fix-#{ASM_1[0, 6]}", assembly: ASM_1, membership: nil, z_mm: 30.0)
      rail_hardware(definition, "rail-mov-#{ASM_1[0, 6]}", assembly: ASM_1, membership: nil, z_mm: 30.0)
      handle_hardware(definition, 'handle-1', host: 'agr-front-1')
      # Cajón 2 (Z mayor)
      front_board(definition, 'agr-front-2', z_mm: 362.0)
      box_board(definition, "agr-49402645-instance-#{ASM_2}-u0-lat-copy-0", z_mm: 362.0)
      rail_hardware(definition, "rail-mov-#{ASM_2[0, 6]}", assembly: ASM_2, membership: nil, z_mm: 362.0)
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_empty scanned.doors
    assert_equal 2, scanned.drawers.length, '2 cajones (frentes emparejados con sus cajas legacy)'

    d0 = scanned.drawers[0]
    assert_equal 'Cajón 1', d0.name
    assert_includes d0.components.map(&:name), 'agr-front-1'
    assert_includes d0.components.map(&:name), "agr-49402645-instance-#{ASM_1}-u0-lat-copy-0"
    assert_includes d0.hardware.map(&:name), 'handle-1'
    assert_includes d0.hardware.map(&:name), "rail-mov-#{ASM_1[0, 6]}"

    d1 = scanned.drawers[1]
    assert_equal 'Cajón 2', d1.name
    assert_includes d1.components.map(&:name), 'agr-front-2'
    assert_includes d1.components.map(&:name), "agr-49402645-instance-#{ASM_2}-u0-lat-copy-0"

    # Las piezas de estructura (st-…) jamás entran a un cajón
    scanned.drawers.each do |d|
      refute_includes d.components.map(&:name), 'st-costado'
    end
  end

  def test_explicit_membership_excludes_body_rails_after_resync
    furniture = build_furniture do |definition|
      front_board(definition, 'agr-front-1', z_mm: 2.0)
      box_board(definition, "agr-49402645-instance-#{ASM_1}-u0-lat-copy-0", z_mm: 30.0)
      # Metadata POST re-sync: memberships explícitas
      rail_hardware(definition, 'rail-fix-1', assembly: ASM_1,
                                              membership: 'body')
      rail_hardware(definition, 'rail-mov-1', assembly: ASM_1,
                                              membership: 'actor:drawer')
    end

    scanned = Granete::SketchUpExtension::Selection::DoorActors.scan(furniture, @store)

    assert_equal 1, scanned.drawers.length
    drawer = scanned.drawers.first
    assert_includes drawer.hardware.map(&:name), 'rail-mov-1'
    refute_includes drawer.hardware.map(&:name), 'rail-fix-1'
  end

  private

  def build_furniture
    definition = @model.definitions.add('furniture-def')
    yield definition
    definition.add_instance(Geom::Transformation.new)
  end

  def front_board(definition, id, z_mm:)
    child = new_child(definition, id, z_mm: z_mm)
    @store.write(child, part_metadata(id, 'placement' => 'frente_cajon', 'role' => 'FRENTES'))
    child
  end

  def box_board(definition, id, z_mm:)
    child = new_child(definition, id, z_mm: z_mm)
    @store.write(child, part_metadata(id, 'placement' => 'lateral_izquierdo', 'role' => 'INTERIOR'))
    child
  end

  def structure_board(definition, id)
    child = new_child(definition, id)
    @store.write(child, part_metadata(id, 'placement' => 'lateral_izquierdo', 'role' => 'INTERIOR'))
    child
  end

  def rail_hardware(definition, id, assembly:, membership:, z_mm: 0.0)
    child = new_child(definition, id, z_mm: z_mm)
    @store.write(child, hardware_metadata(id, 'assemblyInstanceId' => assembly,
                                              'actorMembership' => membership))
    child
  end

  def handle_hardware(definition, id, host:)
    child = new_child(definition, id)
    @store.write(child, hardware_metadata(id, 'hostComponentInstanceId' => host))
    child
  end

  def part_metadata(id, intent)
    {
      'namespace' => NS, 'metadataVersion' => 1, 'kind' => 'componentInstance',
      'identity' => { 'instanceRef' => id, 'componentInstanceId' => id, 'projectRef' => 'p' },
      'intent' => { 'entityClass' => 'part' }.merge(intent)
    }
  end

  def hardware_metadata(id, intent)
    {
      'namespace' => NS, 'metadataVersion' => 1, 'kind' => 'componentInstance',
      'identity' => { 'instanceRef' => id, 'hardwarePlacementId' => id, 'projectRef' => 'p' },
      'intent' => { 'entityClass' => 'hardware' }.merge(intent)
    }
  end

  def new_child(definition, id, z_mm: 0.0)
    t = Geom::Transformation.translation(Geom::Vector3d.new(0, 0, z_mm / 25.4))
    child_definition = @model.definitions.add("child-def-#{id}")
    child = definition.entities.add_instance(child_definition, t)
    child.name = id
    # Host-faithful bounds (#1467): the scan reads the visual edge and the
    # stub's definition box defaults to z=0 — set the occurrence box so each
    # drawer's pieces order by their real height, never by the alphabetical
    # tie-break.
    bb = Geom::BoundingBox.new(50.0, 15.0, z_mm + 150.0)
    bb.min = Geom::Point3d.new(0.0, 0.0, z_mm)
    bb.max = Geom::Point3d.new(50.0, 15.0, z_mm + 150.0)
    child.bounds = bb
    child
  end
end
