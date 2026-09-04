# frozen_string_literal: true

require 'json'

# Shared #498 mutation-orchestration fixture (task §54): a tiny semantic
# world — FurnitureInstance FI-1 owning component C-1 (a shelf occurrence)
# and hardware placement HP-1 (a hinge occurrence), plus accepted states
# V1/V2 — used to prove the coordinator is semantic-target-neutral (it
# transports furniture, component and hardware targets without knowing
# what they are). The #477 responses come from the golden contract the Go
# resolver generated, with correlation rewritten to the coordinator's
# allocated identity so late/matching response semantics are exercised on
# REAL envelopes.
module MutationOrchestrationFixture
  FI_1 = { 'furnitureInstanceRef' => 'inst-fi-1' }.freeze
  C_1_TARGET = { 'furnitureInstanceRef' => FI_1['furnitureInstanceRef'],
                 'componentInstanceId' => 'shelf-01' }.freeze
  HP_1_TARGET = { 'furnitureInstanceRef' => FI_1['furnitureInstanceRef'],
                  'hardwarePlacementId' => 'hp-hinge-01' }.freeze

  GOLDEN_PATH = File.expand_path('../../../../contracts/sketchupAuthoringResolve.contract.json', __dir__).freeze

  H1 = ['board:left', 'board:right', 'board:base', 'board:top', 'board:back', 'board:shelf@520'].freeze
  H2 = ['board:left', 'board:right', 'board:base', 'board:top', 'board:back', 'board:shelf@640',
        'board:shelf@760'].freeze
  M1 = { 'identity' => { 'instanceRef' => 'inst-fi-1' }, 'intent' => { 'shelfCount' => 1 } }.freeze
  M2 = { 'identity' => { 'instanceRef' => 'inst-fi-1' }, 'intent' => { 'shelfCount' => 2 } }.freeze

  module_function

  def golden
    @golden ||= JSON.parse(File.read(GOLDEN_PATH))
  end

  def scenario(id)
    golden['scenarios'].find { |entry| entry['id'] == id } || raise("missing scenario #{id}")
  end

  # Deep copy of a golden response with correlation rewritten to the given
  # request identity, so AuthoringResolveContract.parse! validates it
  # against the coordinator's expected request.
  def response_for(scenario_id, message_id:, idempotency_key:)
    body = JSON.parse(JSON.generate(scenario(scenario_id)['response']))
    body['responseMessageId'] = "resolve-#{message_id}"
    body['inReplyToMessageId'] = message_id
    body['idempotencyKey'] = idempotency_key
    body
  end

  def rejected_response_for(scenario_id, message_id:, idempotency_key:)
    response_for(scenario_id, message_id: message_id, idempotency_key: idempotency_key)
  end

  # Minimal fake host model with real undo semantics: start_operation
  # snapshots, abort restores the snapshot (like SketchUp rollback), commit
  # drops it. Operation order is journaled for atomicity assertions.
  class FakeHostModel
    attr_reader :operations, :hierarchy, :metadata
    attr_accessor :fail_start, :fail_commit

    def initialize(hierarchy = [], metadata = {})
      @hierarchy = hierarchy.dup
      @metadata = JSON.parse(JSON.generate(metadata))
      @operations = []
      @snapshot = nil
      @fail_start = false
      @fail_commit = false
    end

    # rubocop:disable-next Style/OptionalBooleanParameter
    def start_operation(name = 'Granete', _disable_ui = true)
      raise 'host start_operation simulated failure' if @fail_start

      @snapshot = {
        hierarchy: @hierarchy.dup,
        metadata: JSON.parse(JSON.generate(@metadata))
      }
      @operations << [:start, name]
    end

    def commit_operation
      raise 'host commit_operation simulated failure' if @fail_commit

      @operations << [:commit]
      @snapshot = nil
    end

    def abort_operation
      @operations << [:abort]
      if @snapshot
        @hierarchy = @snapshot[:hierarchy].dup
        @metadata = JSON.parse(JSON.generate(@snapshot[:metadata]))
      end
      @snapshot = nil
    end

    def replace_hierarchy!(boards)
      @hierarchy = boards.dup
    end

    def append_hierarchy!(board)
      @hierarchy += [board]
    end

    def set_metadata!(key, value)
      @metadata[key] = value
    end

    def replace_metadata!(meta)
      @metadata = JSON.parse(JSON.generate(meta))
    end

    def operation_names
      @operations.select { |entry| entry.first == :start }.map { |entry| entry[1] }
    end
  end

  # Resolve result double for layout-channel commands.
  def layout_result(layout, request_context, resolve_kind: 'native_layout')
    Granete::SketchUpExtension::Host::LayoutResolveResult.new(
      layout: layout,
      message_id: request_context[:message_id],
      idempotency_key: request_context[:idempotency_key],
      resolve_kind: resolve_kind
    )
  end

  # Command factory: fake-but-contractual command over the fixture world.
  # Coordinator owns the single host operation; apply replaces hierarchy
  # and metadata inside that already-open operation.
  def build_command(model:, semantic_target:, resolve:, apply_mode: :commit,
                    context_valid: -> { true }, restore_selection: nil,
                    manufacturing_affecting: true, name: 'fake_mutation',
                    operation_name: 'Editar Mueble (fixture)')
    apply = lambda do |result, host_context|
      case apply_mode
      when :commit
        boards = result.respond_to?(:layout) && result.layout ? result.layout.boards.map(&:component_instance_id) : []
        model.replace_hierarchy!(boards)
        model.replace_metadata!(M2)
        { 'success' => true, 'component_count' => boards.length }
      when :refuse
        raise Granete::SketchUpExtension::Host::MutationCommand::ApplyRefused, 'el layout resuelto no aplica'
      when :raise_mid_operation
        model.append_hierarchy!('board:partial')
        model.set_metadata!('dirty', true)
        raise 'boom de host durante el rebuild'
      when :two_operations
        # Malicious/buggy command attempts to manage transactions directly
        model.append_hierarchy!('board:dirty')
        model.set_metadata!('dirty', true)
        host_context.start_operation('segunda operación no autorizada', true)
        model.replace_hierarchy!(%w[board:new])
        host_context.commit_operation
        { 'success' => true }
      end
    end

    Granete::SketchUpExtension::Host::MutationCommand.new(
      name: name,
      operation_name: operation_name,
      semantic_target: semantic_target,
      build_furniture_request: nil,
      resolve: resolve,
      context_valid: context_valid,
      apply: apply,
      restore_selection: restore_selection,
      manufacturing_affecting: manufacturing_affecting
    )
  end
end
