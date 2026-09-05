# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/assets/texture_cache'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/selection/capabilities'
require_relative '../../src/granete_for_sketchup/selection/selection_context'
require_relative '../../src/granete_for_sketchup/selection/capability_policy'
require_relative '../../src/granete_for_sketchup/selection/capability_reasons'
require_relative '../../src/granete_for_sketchup/selection/resolver'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'
require_relative '../../src/granete_for_sketchup/ui/component_authoring_bridge'
require_relative '../support/host_runtime'
require_relative '../../src/granete_for_sketchup/ui/dialog_controller'

# #467 / SU-AUTH-1 dialog wiring: direct internal-component authoring
# (move/add/duplicate/remove) rides the shared #498 coordinator through the
# versioned authoring_mutation channel, echoes the full #477 occurrence
# snapshot, syncs quantity-bound parameters, allocates distinct occurrence
# and relationship identities, and never mutates the host on rejection.
class DialogComponentAuthoringTest < Minitest::Test
  class StatusProvider
    def call
      { 'state' => 'configured', 'heading' => 'Conexión configurada', 'message' => 'x' }
    end
  end

  # Catalog double shaped like the #477 golden resolve: the base layout
  # carries the canonical cabinet (sides/door structural + one movable
  # `interno` shelf), quantity-bound parameters mirror the server's
  # PARAMETER_BINDING_CONFLICT cross-validation, and relationship-driven
  # machining follows every shelf occurrence (auto-materialized like the
  # server does when the authored echo carries no relationship for a copy).
  class ComponentAuthoringCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
    attr_accessor :last_authoring_request, :last_authoring_result, :authoring_rejection,
                  :rename_proposed_ids

    def last_source
      'local'
    end

    def find_definition(definition_id)
      return AUTHORING_DEFINITION if definition_id == AUTHORING_DEFINITION['furniture_definition_id']

      super
    end

    def resolved_layout(_definition_id, _parameters = {}, _choices = {})
      base_layout_body
    end

    def resolve_authoring(request_payload)
      @last_authoring_request = request_payload
      furniture = request_payload['furniture'] || {}
      components = furniture['components'] || []

      if authoring_rejection
        code, message = authoring_rejection
        return rejected_result(request_payload, code, message)
      end

      # Server-side position range authority (#467): the envelope belongs to
      # Granete, never to the plugin.
      out_of_range = (furniture['components'] || []).any? do |c|
        t = c['transform'] && c['transform']['translationMm']
        t.is_a?(Array) && t.length == 3 &&
          (t[0].negative? || t[0] > 600 || t[1].negative? || t[1] > 560 ||
           t[2].negative? || t[2] > 720)
      end
      if out_of_range
        return rejected_result(request_payload, 'TRANSFORM_INVALID',
                               'la posición queda fuera del mueble (0-720 mm de alto)')
      end

      ids = components.map { |component| component['componentInstanceId'] }
      if ids.uniq.length != ids.length
        return rejected_result(request_payload, 'OCCURRENCE_DUPLICATE_ID',
                               'componentInstanceId repetido en el snapshot')
      end

      shelf_occurrences = components.select { |c| c['componentDefinitionId'] == 'mod-comp-shelf' }
      shelf_count = (furniture['parameters'] || {})['shelfCount']
      if shelf_count && shelf_count != shelf_occurrences.length
        return rejected_result(request_payload, 'PARAMETER_BINDING_CONFLICT',
                               'shelfCount no coincide con las ocurrencias de entrepaño')
      end

      result = accepted_result(request_payload, furniture, components, shelf_occurrences)
      @last_authoring_result = result
      result
    end

    AUTHORING_DEFINITION = {
      'furniture_definition_id' => 'kitchen-base-standard',
      'name' => 'Gabinete Base Estándar',
      'parameters' => [
        { 'name' => 'widthMm', 'defaultValue' => 600 },
        { 'name' => 'heightMm', 'defaultValue' => 720 },
        { 'name' => 'depthMm', 'defaultValue' => 560 },
        { 'name' => 'shelfCount', 'defaultValue' => 1, 'type' => 'number', 'integer' => true,
          'binding' => {
            'kind' => 'componentQuantity', 'componentId' => 'comp-shelf',
            'relationship' => {
              'kind' => 'shelf-support', 'sourceRole' => 'shelf-edge',
              'targets' => [
                { 'componentId' => 'comp-side', 'role' => 'inside-face' },
                { 'componentId' => 'comp-side-r', 'role' => 'inside-face' }
              ]
            }
          } }
      ]
    }.freeze

    IDENTITY_BASIS = { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }.freeze

    BASE_BOARDS = [
      { 'componentInstanceId' => 'side-left-01', 'componentDefinitionId' => 'mod-comp-side',
        'catalogComponentId' => 'comp-side', 'slotId' => 'lateral_izquierdo',
        'name' => 'Lateral Izquierdo', 'role' => 'LATERAL',
        'transform' => { 'translationMm' => [0, 0, 0] }, 'dimensionsMm' => [18, 18, 684],
        'localTransform' => { 'translationMm' => [0, 0, 0], 'basis' => IDENTITY_BASIS },
        'widthMm' => 18, 'thicknessMm' => 18, 'lengthMm' => 684 },
      { 'componentInstanceId' => 'side-right-01', 'componentDefinitionId' => 'mod-comp-side-r',
        'catalogComponentId' => 'comp-side-r', 'slotId' => 'lateral_derecho',
        'name' => 'Lateral Derecho', 'role' => 'LATERAL',
        'transform' => { 'translationMm' => [582, 0, 0] }, 'dimensionsMm' => [18, 18, 684],
        'localTransform' => { 'translationMm' => [582, 0, 0], 'basis' => IDENTITY_BASIS },
        'widthMm' => 18, 'thicknessMm' => 18, 'lengthMm' => 684 },
      { 'componentInstanceId' => 'door-01', 'componentDefinitionId' => 'mod-comp-door',
        'catalogComponentId' => 'comp-door', 'slotId' => 'puerta',
        'name' => 'Puerta', 'role' => 'FRENTE',
        'transform' => { 'translationMm' => [2, 560, 2] }, 'dimensionsMm' => [596, 18, 716],
        'localTransform' => { 'translationMm' => [2, 560, 2], 'basis' => IDENTITY_BASIS },
        'widthMm' => 596, 'thicknessMm' => 18, 'lengthMm' => 716 },
      { 'componentInstanceId' => 'shelf-01', 'componentDefinitionId' => 'mod-comp-shelf',
        'catalogComponentId' => 'comp-shelf', 'slotId' => 'interno',
        'name' => 'Entrepaño', 'role' => 'INTERIOR',
        'authoringCapability' => { 'movable' => true, 'axis' => 'z' },
        'transform' => { 'translationMm' => [18, 18, 150] }, 'dimensionsMm' => [542, 18, 564],
        'localTransform' => { 'translationMm' => [18, 18, 150], 'basis' => IDENTITY_BASIS },
        'widthMm' => 542, 'thicknessMm' => 18, 'lengthMm' => 564 }
    ].freeze

    BASE_HARDWARE = [
      { 'placementId' => 'HP-TOP', 'hardwareId' => 'hw-hinge', 'name' => 'Bisagra TOP',
        'placementKind' => 'manual', 'hostComponentInstanceId' => 'door-01',
        'anchorFace' => 'front', 'offsetMm' => [298, 100],
        'transform' => { 'translationMm' => [298, 560, 100] } }
    ].freeze

    def base_layout_body
      {
        'furnitureDefinitionId' => 'kitchen-base-standard',
        'definitionName' => 'Gabinete Base Estándar',
        'transformContract' => 'granete.local-basis.v1',
        'dimensionsMm' => [600, 720, 560],
        'components' => BASE_BOARDS.map(&:dup),
        'hardware' => BASE_HARDWARE.map(&:dup)
      }
    end

    private

    def rejected_result(request_payload, code, message)
      body = {
        'schemaId' => 'granete.sketchup-authoring-resolve.v1',
        'schemaName' => 'granete.sketchup-authoring-resolve',
        'schemaVersion' => '1.0',
        'resolveContract' => 'granete.sketchup-authoring-resolve.v1',
        'status' => 'rejected',
        'responseMessageId' => "resolve-#{request_payload['messageId']}",
        'inReplyToMessageId' => request_payload['messageId'],
        'idempotencyKey' => request_payload['idempotencyKey'],
        'issues' => [
          { 'code' => code, 'message' => message, 'severity' => 'error',
            'entityId' => 'shelf-01', 'path' => 'furniture.components',
            'remediation' => 'Corregí la intención de autoría según el contrato.' }
        ]
      }
      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
        body, expected_request: request_payload
      )
    end

    def accepted_result(request_payload, furniture, components, _shelf_occurrences)
      authored_rels = furniture['relationships'] || []
      # Optional server-settled identity: with rename_proposed_ids the echo
      # settles a DIFFERENT id than the client proposal, proving the host is
      # driven by the ACCEPTED identity (design-A robustness proof).
      rename = lambda do |id|
        rename_proposed_ids && id.start_with?('ci-') ? 'shelf-accepted-01' : id
      end
      accepted_components = components.map do |component|
        component.merge('componentInstanceId' => rename.call(component['componentInstanceId']))
      end
      accepted_shelves = accepted_components.select do |component|
        component['componentDefinitionId'] == 'mod-comp-shelf'
      end
      relationships = effective_relationships(authored_rels, accepted_shelves)

      snapshot_components = accepted_components.map do |component|
        base = BASE_BOARDS.find { |board| board['componentInstanceId'] == component['componentInstanceId'] }
        entry = {
          'componentInstanceId' => component['componentInstanceId'],
          'componentDefinitionId' => component['componentDefinitionId'],
          'catalogComponentId' => base ? base['catalogComponentId'] : 'comp-shelf',
          'role' => base ? base['role'] : 'INTERIOR'
        }
        entry['transform'] = component['transform'] if component['transform']
        entry
      end

      layout_boards = accepted_components.map do |component|
        board_for(component, BASE_BOARDS.find do |b|
          b['componentInstanceId'] == component['componentInstanceId']
        end)
      end
      placements = furniture['hardwarePlacements'] || []
      layout_hardware = placements.map do |placement|
        offset = placement['offsetMm'] || [0.0, 0.0]
        {
          'placementId' => placement['hardwarePlacementId'],
          'hardwareId' => placement['catalogHardwareId'],
          'name' => "Herraje #{placement['hardwarePlacementId']}",
          'placementKind' => placement['placementKind'] || 'manual',
          'hostComponentInstanceId' => placement['hostComponentInstanceId'],
          'anchorFace' => placement['anchorFace'] || 'front',
          'offsetMm' => offset,
          'transform' => { 'translationMm' => [offset[0], 560, offset[1]] }
        }
      end

      source_z = lambda do |relationship|
        source = accepted_components.find do |component|
          component['componentInstanceId'] == relationship.dig('source', 'componentInstanceId')
        end
        z = source && source['transform'] ? source['transform']['translationMm'][2] : 150
        z.to_f
      end

      shelf_ops = relationships.map do |relationship|
        {
          'operationId' => "op-#{relationship['relationshipId']}",
          'hostComponentInstanceId' => relationship['targets'].first['componentInstanceId'],
          'provenance' => {
            'sourceKind' => 'relationship',
            'relationshipId' => relationship['relationshipId']
          },
          'holes' => [
            { 'face' => 'left', 'xMm' => source_z.call(relationship), 'yMm' => 50.0,
              'diameterMm' => 15.0, 'depthMm' => 12.0, 'type' => 'shelf_support_hole' }
          ]
        }
      end
      manual_ops = placements.map do |placement|
        offset = placement['offsetMm'] || [0.0, 0.0]
        {
          'operationId' => "op-#{placement['hardwarePlacementId']}",
          'hostComponentInstanceId' => placement['hostComponentInstanceId'],
          'provenance' => {
            'sourceKind' => 'manualHardwarePlacement',
            'hardwarePlacementId' => placement['hardwarePlacementId']
          },
          'holes' => [
            { 'face' => placement['anchorFace'] || 'front', 'xMm' => offset[0].to_f,
              'yMm' => offset[1].to_f, 'diameterMm' => 35.0, 'depthMm' => 12.0,
              'type' => 'hinge_cup' }
          ]
        }
      end
      derived = relationships.map do |relationship|
        {
          'derivedHardwarePlacementId' => "dhp-#{relationship['relationshipId']}",
          'hostComponentInstanceId' => relationship['targets'].first['componentInstanceId'],
          'provenance' => {
            'sourceKind' => 'relationship',
            'relationshipId' => relationship['relationshipId']
          }
        }
      end

      body = {
        'schemaId' => 'granete.sketchup-authoring-resolve.v1',
        'schemaName' => 'granete.sketchup-authoring-resolve',
        'schemaVersion' => '1.0',
        'resolveContract' => 'granete.sketchup-authoring-resolve.v1',
        'status' => 'accepted',
        'responseMessageId' => "resolve-#{request_payload['messageId']}",
        'inReplyToMessageId' => request_payload['messageId'],
        'idempotencyKey' => request_payload['idempotencyKey'],
        'catalogRevision' => 'rev-component-authoring-1',
        'issues' => [],
        'normalizedSnapshot' => {
          'parameters' => { 'shelfCount' => accepted_shelves.length }
                               .merge(furniture['parameters'] || {}),
          'materialChoices' => furniture['materialChoices'] || {},
          'components' => snapshot_components,
          'relationships' => relationships,
          'hardwarePlacements' => placements.map do |placement|
            {
              'hardwarePlacementId' => placement['hardwarePlacementId'],
              'catalogHardwareId' => placement['catalogHardwareId'],
              'hostComponentInstanceId' => placement['hostComponentInstanceId'],
              'anchorFace' => placement['anchorFace'] || 'front',
              'offsetMm' => placement['offsetMm']
            }
          end
        },
        'resolved' => {
          'preflight' => {
            'scope' => 'authoring-resolve-subset', 'status' => 'clear',
            'preflightContract' => 'granete.manufacturing-preflight.v1', 'issues' => []
          },
          'layout' => {
            'furnitureDefinitionId' => 'kitchen-base-standard',
            'definitionName' => 'Gabinete Base Estándar',
            'transformContract' => 'granete.local-basis.v1',
            'dimensionsMm' => [600, 720, 560],
            'components' => layout_boards,
            'hardware' => layout_hardware
          },
          'machining' => {
            'operations' => shelf_ops + manual_ops,
            'derivedHardwarePlacements' => derived,
            'manufacturingFingerprint' => "sha256-#{Digest::SHA256.hexdigest(JSON.generate(layout_boards))}"
          }
        }
      }

      Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
        body, expected_request: request_payload
      )
    end

    def board_for(component, base)
      translation = component['transform'] ? component['transform']['translationMm'] : nil
      local = translation || (base ? base['transform']['translationMm'] : [18, 18, 150])
      {
        'componentInstanceId' => component['componentInstanceId'],
        'componentDefinitionId' => component['componentDefinitionId'],
        'catalogComponentId' => base ? base['catalogComponentId'] : 'comp-shelf',
        'slotId' => base ? base['slotId'] : 'interno',
        'name' => base ? base['name'] : 'Entrepaño',
        'role' => base ? base['role'] : 'INTERIOR',
        'transform' => { 'translationMm' => local },
        'dimensionsMm' => base ? base['dimensionsMm'] : [542, 18, 564],
        'localTransform' => { 'translationMm' => local, 'basis' => IDENTITY_BASIS },
        'widthMm' => base ? base['widthMm'] : 542,
        'thicknessMm' => base ? base['thicknessMm'] : 18,
        'lengthMm' => base ? base['lengthMm'] : 564
      }
    end

    # Mirror of the server's bound-relationship materialization: every shelf
    # occurrence keeps a shelf-support relationship (authored identity wins,
    # missing ones materialize with deterministic parameter-* identities).
    def effective_relationships(authored, shelf_occurrences)
      result = authored.select { |relationship| relationship['kind'] == 'shelf-support' }
      has = result.to_h { |relationship| [relationship.dig('source', 'componentInstanceId'), true] }
      shelf_occurrences.each_with_index do |occurrence, index|
        next if has[occurrence['componentInstanceId']]

        result += [{
          'relationshipId' => "parameter-shelfCount-#{index + 1}",
          'kind' => 'shelf-support',
          'source' => { 'componentInstanceId' => occurrence['componentInstanceId'],
                        'role' => 'shelf-edge' },
          'targets' => [
            { 'componentInstanceId' => 'side-left-01', 'role' => 'inside-face' },
            { 'componentInstanceId' => 'side-right-01', 'role' => 'inside-face' }
          ]
        }]
      end
      result
    end
  end

  def setup
    SketchupStub.reset!
    @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @catalog = ComponentAuthoringCatalog.new
    @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
      logger: @logger,
      status_provider: StatusProvider.new,
      metadata_store: @store,
      catalog_provider: @catalog
    )
  end

  def place_canonical_cabinet(instance_ref)
    @instance_ref = instance_ref
    definition = @model.definitions.add("Granete · Mueble · #{instance_ref}")
    furniture = @model.active_entities.add_instance(definition, Geom::Transformation.identity)
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, furniture, instance_ref,
      { 'furniture_definition_id' => 'kitchen-base-standard' }, {}
    )

    dialog = @controller.show
    dialog.callbacks.fetch('update_furniture').call(
      nil, 'instanceId' => instance_ref, 'definitionId' => 'kitchen-base-standard'
    )
    furniture
  end

  def component_command(mutation, payload, instance_ref: nil, component_id: 'shelf-01')
    {
      'schemaId' => 'granete.sketchup-host-command.v1',
      'messageId' => "cmd-#{mutation}-1",
      'mutation' => mutation,
      'semanticTarget' => {
        'furnitureInstanceRef' => instance_ref || @instance_ref,
        'componentInstanceId' => component_id
      },
      'payload' => payload
    }
  end

  def submit_component_command(dialog, command)
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(command))
    dialog.executed_scripts.find { |script| script.include?(command['messageId']) }
  end

  def child_by_component_id(furniture, component_id)
    Granete::SketchUpExtension::Host::SelectionRestore
      .new(metadata_store_factory: ->(_) { @store }, model_provider: -> { @model })
      .send(:locate_child, furniture, 'componentInstanceId' => component_id)
  end

  def child_ids(furniture)
    furniture.definition.entities.map do |entity|
      @store.read(entity)&.dig('identity', 'componentInstanceId')
    end.compact
  end

  def test_select_shelf_exposes_exact_identity_and_internal_capabilities
    furniture = place_canonical_cabinet('inst-cap')
    shelf = child_by_component_id(furniture, 'shelf-01')
    refute_nil shelf

    context = Granete::SketchUpExtension::Selection::Resolver
              .new(metadata_store: @store,
                   catalog_provider: @catalog, model_provider: -> { @model })
              .resolve(shelf)

    assert_equal 'part', context.kind
    assert_equal 'shelf-01', context.component_instance_id
    assert_equal 'mod-comp-shelf', context.component_definition_id
    assert_equal 'interno', context.component_placement
    assert_equal({ 'movable' => true, 'axis' => 'z' }, context.authoring_capability)
    assert context.capabilities.supported?('canMoveWithinConstraint')
    assert context.capabilities.supported?('canDuplicate')
    assert context.capabilities.supported?('canAddRelated')
    assert context.capabilities.supported?('canRemove')
    refute context.capabilities.supported?('canChangeJoinery')
  end

  def test_structural_part_capabilities_stay_unsupported_with_reason
    furniture = place_canonical_cabinet('inst-struct')
    door = child_by_component_id(furniture, 'door-01')
    refute_nil door

    context = Granete::SketchUpExtension::Selection::Resolver
              .new(metadata_store: @store,
                   catalog_provider: @catalog, model_provider: -> { @model })
              .resolve(door)

    assert_equal 'part', context.kind
    assert_equal 'puerta', context.component_placement
    refute context.capabilities.supported?('canMoveWithinConstraint')
    refute_nil context.capabilities['canMoveWithinConstraint'].reason
  end

  def test_move_shelf_updates_pose_and_dependent_machining_preserving_identity
    furniture = place_canonical_cabinet('inst-move')
    dialog = @controller.show

    script = submit_component_command(dialog, component_command('move_component', { 'translationMm' => [18, 18, 520] }))
    refute_nil script
    assert_includes script, '"outcome":"committed"'

    # Authoritative request shape: full occurrence echo, target transform
    # override, quantity parameter echoed consistently.
    request = @catalog.last_authoring_request['furniture']
    moved = request['components'].find { |c| c['componentInstanceId'] == 'shelf-01' }
    assert_equal [18, 18, 520], moved['transform']['translationMm']
    assert_equal 'assembly', moved['transform']['frame']
    assert_equal 4, request['components'].length
    assert_equal 1, request['parameters']['shelfCount']

    # Dependent relationship machining follows the shelf (side-panel holes
    # now at z=520); identity and pose metadata survive the atomic rebuild.
    shelf_op = @catalog.last_authoring_result.operations.find do |op|
      op.provenance['sourceKind'] == 'relationship'
    end
    refute_nil shelf_op
    assert_equal 520.0, shelf_op.holes.first['xMm']

    rebuilt_shelf = child_by_component_id(furniture, 'shelf-01')
    refute_nil rebuilt_shelf, 'componentInstanceId must survive the rebuild'
    meta = @store.read(rebuilt_shelf)
    assert_equal 'shelf-01', meta.dig('identity', 'componentInstanceId')
    assert_equal 'interno', meta.dig('intent', 'placement')
    assert_equal [18, 18, 520], meta.dig('intent', 'assemblyTranslationMm')
    refute_nil child_by_component_id(furniture, 'door-01'), 'door must remain'

    assert_equal [rebuilt_shelf], @model.selection.to_a,
                 'selection must restore to the exact occurrence by identity'
  end

  def test_move_structural_part_is_rejected_without_mutation
    furniture = place_canonical_cabinet('inst-structural-move')
    children_before = child_ids(furniture)
    dialog = @controller.show

    script = submit_component_command(dialog, component_command(
                                                'move_component', { 'translationMm' => [5, 5, 5] },
                                                component_id: 'door-01'
                                              ))
    refute_nil script
    assert_includes script, '"outcome":"rejected"'
    assert_includes script, 'OCCURRENCE_COUNT_UNSUPPORTED'
    assert_nil @catalog.last_authoring_request, 'no resolve may leave the plugin'
    assert_equal children_before, child_ids(furniture), 'hierarchy must stay intact'
  end

  def test_move_out_of_furniture_bounds_is_rejected_by_the_server_not_locally
    furniture = place_canonical_cabinet('inst-range')
    children_before = child_ids(furniture)
    dialog = @controller.show

    # The request LEAVES the plugin (no local envelope decision) and only the
    # authoritative resolve rejects it with the canonical code + range.
    script = submit_component_command(dialog,
                                      component_command('move_component', { 'translationMm' => [18, 18, 900] }))
    refute_nil script
    assert_includes script, '"outcome":"rejected"'
    assert_includes script, 'TRANSFORM_INVALID'
    assert_includes script, 'fuera del mueble'
    refute_nil @catalog.last_authoring_request,
               'range validity is server authority: the request must leave the plugin'
    assert_equal children_before, child_ids(furniture)
  end

  def test_move_with_malformed_position_is_rejected_locally_as_transport_shape
    place_canonical_cabinet('inst-shape')
    dialog = @controller.show

    script = submit_component_command(dialog,
                                      component_command('move_component', { 'translationMm' => [18, 'x', 200] }))
    refute_nil script
    assert_includes script, '"outcome":"rejected"'
    assert_includes script, 'TRANSFORM_INVALID'
    assert_nil @catalog.last_authoring_request,
               'malformed transport shape never reaches the server'
  end

  def test_add_second_shelf_shares_definition_with_distinct_identity
    furniture = place_canonical_cabinet('inst-add')
    dialog = @controller.show

    script = submit_component_command(dialog, component_command('add_component', { 'translationMm' => [18, 18, 420] }))
    refute_nil script
    assert_includes script, '"outcome":"committed"'

    request = @catalog.last_authoring_request['furniture']
    shelves = request['components'].select { |c| c['componentDefinitionId'] == 'mod-comp-shelf' }
    assert_equal 2, shelves.length
    assert_equal 2, shelves.map { |c| c['componentInstanceId'] }.uniq.length,
                 'each occurrence needs its own componentInstanceId'
    assert_equal %w[mod-comp-shelf mod-comp-shelf], shelves.map { |c| c['componentDefinitionId'] },
                 'the reusable definition is shared'
    assert_equal 2, request['parameters']['shelfCount'],
                 'the quantity-bound parameter must stay consistent'

    # The client NEVER authors relationship topology: no relationship for the
    # new occurrence rides the request — the server materializes it.
    proposed_new = (shelves.map { |c| c['componentInstanceId'] } - ['shelf-01']).first
    authored_for_new = (request['relationships'] || []).select do |relationship|
      relationship.dig('source', 'componentInstanceId') == proposed_new
    end
    assert_empty authored_for_new,
                 'relationship topology must be server-authored, never client-constructed'

    refute_nil child_by_component_id(furniture, 'shelf-01')
    refute_nil child_by_component_id(furniture, proposed_new),
               'the new occurrence must render after the atomic rebuild'

    assert_equal 2, @catalog.last_authoring_result.operations.count { |op|
      op.provenance['sourceKind'] == 'relationship'
    }, 'each shelf drives its dependent machining'

    # The persisted relationship set is the server-materialized echo with
    # server-owned identities (one per occurrence, non-colliding).
    furniture_relationships = @store.read(furniture)['relationships']
    assert_equal 2, furniture_relationships.length
    sources = furniture_relationships.map { |r| r.dig('source', 'componentInstanceId') }
    assert_equal sources.uniq.length, sources.length
    furniture_relationships.each do |relationship|
      refute_match(/\Arel-/, relationship['relationshipId'],
                   'no client-minted relationship identity may persist')
    end
  end

  def test_duplicate_allocates_new_occurrence_and_relationship_identities
    furniture = place_canonical_cabinet('inst-dup')
    dialog = @controller.show

    script = submit_component_command(dialog,
                                      component_command('duplicate_component', { 'translationMm' => [18, 18, 300] }))
    refute_nil script
    assert_includes script, '"outcome":"committed"'

    request = @catalog.last_authoring_request['furniture']
    shelves = request['components'].select { |c| c['componentDefinitionId'] == 'mod-comp-shelf' }
    assert_equal 2, shelves.length
    new_ids = shelves.map { |c| c['componentInstanceId'] }
    assert_equal 2, new_ids.uniq.length, 'each duplicate occurrence has its own identity'
    duplicate_id = (new_ids - ['shelf-01']).first
    refute_nil duplicate_id, 'duplicate never reuses the source identity'
    assert_match(/\Aci-/, duplicate_id)

    # No client-authored relationship for the duplicate — server topology.
    authored_for_new = (request['relationships'] || []).select do |relationship|
      relationship.dig('source', 'componentInstanceId') == duplicate_id
    end
    assert_empty authored_for_new,
                 'the duplicate relationship is server-materialized, never client-built'

    refute_nil child_by_component_id(furniture, new_ids.first)
    refute_nil child_by_component_id(furniture, new_ids.last),
               'both occurrences render after the rebuild'
  end

  # Required proof (#467 final correction): the draft/proposal id may differ
  # from the ACCEPTED id — the host renders, stamps and SELECTS the accepted
  # occurrence.
  def test_accepted_identity_drives_host_rendering_metadata_and_selection
    furniture = place_canonical_cabinet('inst-accepted')
    @catalog.rename_proposed_ids = true
    dialog = @controller.show

    script = submit_component_command(dialog, component_command('add_component', { 'translationMm' => [18, 18, 420] }))
    refute_nil script
    assert_includes script, '"outcome":"committed"'

    request = @catalog.last_authoring_request['furniture']
    proposed = (request['components'].map { |c| c['componentInstanceId'] } - child_ids(furniture)).first
    assert_match(/\Aci-/, proposed, 'the client proposed a draft occurrence id')

    accepted = child_by_component_id(furniture, 'shelf-accepted-01')
    refute_nil accepted, 'the host renders the ACCEPTED occurrence identity'
    assert_equal 'shelf-accepted-01', @store.read(accepted).dig('identity', 'componentInstanceId')
    assert_nil child_by_component_id(furniture, proposed),
               'the draft id never becomes productive truth'

    assert_equal [accepted], @model.selection.to_a,
                 'selection restores to the ACCEPTED new occurrence by identity'
  end

  def test_remove_shelf_drops_only_its_dependent_relationships_and_machining
    furniture = place_canonical_cabinet('inst-remove')
    dialog = @controller.show

    script = submit_component_command(dialog, component_command('remove_component', {}))
    refute_nil script
    assert_includes script, '"outcome":"committed"'

    request = @catalog.last_authoring_request['furniture']
    assert_equal 3, request['components'].length, 'the shelf occurrence is dropped'
    assert_equal 0, request['parameters']['shelfCount']
    assert_nil request['relationships'],
               'a removal sends no relationship topology — cleanup is server-owned'

    assert_nil child_by_component_id(furniture, 'shelf-01'), 'the occurrence is gone'
    refute_nil child_by_component_id(furniture, 'door-01'), 'unrelated components stay'
    refute_nil child_by_component_id(furniture, 'side-left-01')

    assert_equal 0, @catalog.last_authoring_result.operations.count { |op|
      op.provenance['sourceKind'] == 'relationship'
    }, 'dependent relationship machining is removed with the occurrence'
    assert_equal 1, @catalog.last_authoring_result.operations.length,
                 'unrelated manual machining survives'

    assert_nil @store.read(furniture)['relationships'],
               'the cleared relationship state removes the persisted set'
  end

  def test_failed_resolve_leaves_previous_hierarchy_and_metadata_intact
    furniture = place_canonical_cabinet('inst-fail')
    children_before = child_ids(furniture)
    meta_before = @store.read(furniture)
    dialog = @controller.show

    @catalog.authoring_rejection = ['PARAMETER_BINDING_CONFLICT', 'shelfCount no coincide']
    script = submit_component_command(dialog, component_command('move_component', { 'translationMm' => [18, 18, 400] }))
    refute_nil script
    assert_includes script, '"outcome":"rejected"'
    assert_includes script, 'PARAMETER_BINDING_CONFLICT'

    assert_equal children_before, child_ids(furniture)
    assert_equal meta_before, @store.read(furniture)
  end

  def test_component_mutations_ride_the_versioned_channel_contract
    furniture = place_canonical_cabinet('inst-channel')
    dialog = @controller.show

    invalid = component_command('move_shelf', { 'translationMm' => [1, 1, 1] })
    children_before = child_ids(furniture)
    dialog.callbacks.fetch('authoring_mutation').call(nil, JSON.generate(invalid))

    mutation_script = dialog.executed_scripts.reverse.find { |s| s.include?('onMutationState') }
    refute_nil mutation_script
    assert_includes mutation_script, '"outcome":"rejected"'
    assert_includes mutation_script, 'Mutación desconocida'
    assert_equal children_before, child_ids(furniture),
                 'an unknown mutation never touches the productive hierarchy'
  end

  def test_committed_mutation_invalidates_preflight_for_both_lookup_keys
    place_canonical_cabinet('inst-preflight')
    dialog = @controller.show

    submit_component_command(dialog, component_command('move_component', { 'translationMm' => [18, 18, 500] }))

    preflight_script = dialog.executed_scripts.find { |s| s.include?('onPreflightState') }
    refute_nil preflight_script, 'a committed component edit must invalidate preflight'
    assert_includes preflight_script, '"state":"stale"'
  end
end
