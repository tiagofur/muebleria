# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        # Restores one WorkingCopy-owned FurnitureInstance into the exact
        # active SketchUp document. This is host repair, not placement: it
        # never creates business identity, never writes the WorkingCopy and
        # never hands control to the Move tool.
        class Restorer # rubocop:disable Metrics/ClassLength
          class RestoreFailure < StandardError
            attr_reader :code

            def initialize(code, message)
              @code = code
              super(message)
            end
          end

          def initialize(model_provider:, binding_store_factory:, model_binding_service:, service:,
                         metadata_store_factory:, catalog_provider:, furniture_builder_factory:,
                         host_reconciliation:, logger: SafeLogger.new)
            @model_provider = model_provider
            @binding_store_factory = binding_store_factory
            @model_binding_service = model_binding_service
            @service = service
            @metadata_store_factory = metadata_store_factory
            @catalog_provider = catalog_provider
            @furniture_builder_factory = furniture_builder_factory
            @host_reconciliation = host_reconciliation
            @logger = logger
            @guard = Mutex.new
            @in_flight = {}
          end

          def restore(furniture_instance_id)
            return failure('invalid_identity', 'la identidad del mueble no es válida') unless
              ProjectFurniture.uuid?(furniture_instance_id)

            model = @model_provider.call
            return failure('no_model', 'no hay un modelo activo', furniture_instance_id) unless model

            binding = binding_store(model).read
            unless binding
              return failure('unbound', 'conectá este modelo a un proyecto y diseño primero', furniture_instance_id)
            end

            key = [model.object_id, furniture_instance_id]
            unless claim?(key)
              return failure('action_in_progress', 'la restauración de este mueble ya está en curso',
                             furniture_instance_id)
            end

            begin
              restore_guarded(model, binding, furniture_instance_id)
            ensure
              finish_claim(key)
            end
          rescue Service::Error => e
            failure('service_error', e.message, furniture_instance_id)
          rescue PlacementResolutionError => e
            failure('recovery_blocked', e.message, furniture_instance_id)
          rescue Contract::ContractError => e
            failure('bad_contract', e.message, furniture_instance_id)
          rescue RestoreFailure => e
            failure(e.code, e.message, furniture_instance_id)
          rescue StandardError => e
            @logger.error('project_furniture_restore_failed', error: e,
                                                              furniture_instance_id: furniture_instance_id)
            failure('restore_failed', e.message, furniture_instance_id)
          end

          private

          # rubocop:disable-next Metrics/AbcSize
          def restore_guarded(model, binding, furniture_instance_id)
            initial = authority(model, binding, furniture_instance_id)
            if initial[:local].length == 1
              assert_exact_root!(model, initial[:local].first[:entity], initial, binding)
              return success(furniture_instance_id, restored: false)
            end
            raise RestoreFailure.new('duplicate_detected', DUPLICATE_MESSAGE) if initial[:local].length > 1

            definition = @catalog_provider.find_definition(initial[:item].furniture_definition_id)
            unless definition && definition['furniture_definition_id'] == initial[:item].furniture_definition_id
              raise RestoreFailure.new('recovery_blocked',
                                       'el catálogo del taller no incluye la definición exacta de este mueble')
            end
            layout = WorkingCopyMerger.resolve_layout(
              @catalog_provider, definition, initial[:item].parameters, initial[:item].material_choices
            )
            transform = exact_transform!(initial[:item].transform)

            fresh = authority(model, binding, furniture_instance_id)
            assert_same_authority!(initial, fresh)
            raise RestoreFailure.new('duplicate_detected', DUPLICATE_MESSAGE) unless fresh[:local].empty?

            builder = @furniture_builder_factory.call(model)
            operation_open = false
            model.start_operation("Restaurar Mueble del Proyecto #{definition['name']}", true)
            operation_open = true
            inserted = builder.place_existing_furniture(
              model, furniture_instance_id: furniture_instance_id, definition: definition,
                     parameters: initial[:item].parameters, material_choices: initial[:item].material_choices,
                     resolved_layout: layout, project_id: binding.project_id, design_id: binding.design_id,
                     transformation: transform, prepare: false, preserve_parameters: true, transaction: false
            )
            raise RestoreFailure.new('placement_failed', inserted['error']) unless inserted['success']

            entity = inserted['entity']
            verify_inserted!(model, binding, furniture_instance_id, initial, entity)
            model.commit_operation
            operation_open = false
            @logger.info('project_furniture_restored', furniture_instance_id: furniture_instance_id,
                                                       project_id: binding.project_id,
                                                       design_id: binding.design_id)
            success(furniture_instance_id, restored: true)
          rescue RestoreFailure, Service::Error, PlacementResolutionError, Contract::ContractError, StandardError
            model.abort_operation if operation_open
            raise
          end

          def verify_inserted!(model, binding, furniture_instance_id, initial, entity)
            fresh = authority(model, binding, furniture_instance_id)
            assert_same_authority!(initial, fresh, ignore_local: true)
            unless fresh[:local].length == 1 && fresh[:local].first[:entity].equal?(entity)
              raise RestoreFailure.new('host_readback_failed',
                                       'la restauración no produjo una única entidad raíz verificable')
            end
            assert_exact_root!(model, entity, fresh, binding)

            projection = @host_reconciliation.projection(model: model, binding: binding)
            row = projection['items']&.find { |candidate| candidate['id'] == furniture_instance_id }
            unless projection['state'] == 'connected' && row &&
                   row['reconciliationState'] == 'present_synced' && row['localMatchCount'] == 1
              raise RestoreFailure.new('host_readback_failed',
                                       'el archivo no confirmó la restauración contra Granete')
            end
          end

          # rubocop:disable-next Metrics/AbcSize
          def authority(model, binding, furniture_instance_id)
            assert_context!(model, binding)
            instances = @service.list_project_furniture(binding.project_id)
            matches = instances.select { |candidate| candidate.id == furniture_instance_id }
            raise RestoreFailure.new('not_found', 'el mueble no pertenece al proyecto conectado') if matches.empty?
            unless matches.length == 1 && matches.first.project_id == binding.project_id
              raise RestoreFailure.new('incompatible', 'la identidad del mueble no es única en este proyecto')
            end
            unless matches.first.lifecycle_status == 'active'
              raise RestoreFailure.new('terminal', 'el mueble ya no está activo en el proyecto')
            end

            working = @service.get_working_copy(binding.design_id)
            assert_working_context!(working, binding)
            items = working.items.select { |candidate| candidate.furniture_instance_id == furniture_instance_id }
            unless items.length == 1
              raise RestoreFailure.new('working_copy_changed',
                                       'el Working Copy ya no contiene exactamente este mueble')
            end
            item = items.first
            if item.furniture_definition_id != matches.first.furniture_definition_id
              raise RestoreFailure.new('incompatible',
                                       'la definición del Working Copy no coincide con el mueble del proyecto')
            end
            exact_transform!(item.transform)
            local = ManagedFurniture.index(model, @metadata_store_factory.call(model))[:by_id][furniture_instance_id]
            assert_context!(model, binding)
            { unit: matches.first, working: working, item: item, local: local,
              unit_snapshot: canonical(matches.first.to_h), working_snapshot: working_snapshot(working) }
          end

          def assert_context!(model, binding)
            unless @model_provider.call.equal?(model)
              raise RestoreFailure.new('context_changed', 'el modelo activo cambió durante la restauración')
            end

            current = binding_store(model).read
            unless current && current.to_h == binding.to_h
              raise RestoreFailure.new('binding_changed', 'el enlace del modelo cambió durante la restauración')
            end

            failure = PlacementGuards.validate_binding_current(binding, @model_binding_service)
            raise RestoreFailure.new(failure['code'], failure['reason']) if failure
          end

          def assert_working_context!(working, binding)
            return if working.project_id == binding.project_id && working.design_id == binding.design_id &&
                      working.base_revision_id == binding.base_revision_id

            raise RestoreFailure.new('working_copy_changed',
                                     'el Working Copy no corresponde al enlace exacto del modelo')
          end

          def assert_same_authority!(initial, fresh, ignore_local: false)
            same = initial[:unit_snapshot] == fresh[:unit_snapshot] &&
                   initial[:working_snapshot] == fresh[:working_snapshot]
            same &&= initial[:local].length == fresh[:local].length unless ignore_local
            return if same

            raise RestoreFailure.new('authority_changed',
                                     'el mueble o el Working Copy cambió durante la restauración')
          end

          # rubocop:disable-next Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/PerceivedComplexity
          def assert_exact_root!(model, entity, authority, binding)
            assert_context!(model, binding)
            metadata = @metadata_store_factory.call(model).read(entity)
            identity = metadata.is_a?(Hash) ? metadata['identity'] : nil
            intent = metadata.is_a?(Hash) ? metadata['intent'] : nil
            item = authority[:item]
            exact = metadata&.dig('kind') == 'furnitureInstance' &&
                    identity&.dig('furnitureInstanceId') == item.furniture_instance_id &&
                    identity&.dig('projectId') == binding.project_id &&
                    identity&.dig('designId') == binding.design_id &&
                    intent&.dig('furnitureDefinitionId') == item.furniture_definition_id &&
                    intent&.dig('parameters') == item.parameters &&
                    (intent&.dig('materialChoices') || {}) == (item.material_choices || {}) &&
                    TransformContract.equivalent_to_host?(item.transform, entity.transformation)
            return if exact

            raise RestoreFailure.new('host_readback_failed',
                                     'la entidad raíz restaurada no coincide exactamente con el Working Copy')
          rescue JSON::ParserError, Metadata::InvalidMetadataError
            raise RestoreFailure.new('host_readback_failed', 'los metadatos restaurados no se pudieron leer')
          end

          def exact_transform!(transform)
            valid = transform.is_a?(Hash) && %w[translation_mm rotation_deg].all? do |key|
              transform[key].is_a?(Array) && transform[key].length == 3 && transform[key].all?(Numeric)
            end
            unless valid
              raise RestoreFailure.new('invalid_transform',
                                       'el Working Copy no contiene una transformación válida')
            end

            TransformContract.to_host(transform)
          end

          def working_snapshot(working)
            canonical(
              'projectId' => working.project_id, 'designId' => working.design_id,
              'baseRevisionId' => working.base_revision_id,
              'items' => working.items.map(&:to_contract_h).sort_by { |item| item['furniture_instance_id'] }
            )
          end

          def canonical(value)
            JSON.generate(deep_sort(JSON.parse(JSON.generate(value))))
          end

          def deep_sort(value)
            case value
            when Hash then value.keys.sort.to_h { |key| [key, deep_sort(value[key])] }
            when Array then value.map { |entry| deep_sort(entry) }
            else value
            end
          end

          def binding_store(model)
            @binding_store_factory.arity.zero? ? @binding_store_factory.call : @binding_store_factory.call(model)
          end

          def claim?(key)
            @guard.synchronize do
              return false if @in_flight[key]

              @in_flight[key] = true
            end
            true
          end

          def finish_claim(key)
            @guard.synchronize { @in_flight.delete(key) }
          end

          def success(furniture_instance_id, restored:)
            { 'ok' => true, 'code' => 'present_synced', 'instanceId' => furniture_instance_id,
              'restored' => restored }
          end

          def failure(code, reason, furniture_instance_id = nil)
            result = { 'ok' => false, 'code' => code.to_s, 'reason' => reason }
            result['instanceId'] = furniture_instance_id if ProjectFurniture.uuid?(furniture_instance_id)
            result
          end
        end
      end
    end
  end
end
