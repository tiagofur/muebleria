# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Library
      # One resolved board with its authoritative local→furniture transform
      # (#414). AABB accessors are convenience/preview passthrough and may
      # be nil — orientation lives exclusively in basis/translation.
      class LayoutBoardTransform
        attr_reader :component_instance_id, :slot_id, :name,
                    :width_mm, :thickness_mm, :length_mm,
                    :translation, :basis, :aabb_min, :aabb_size

        def initialize(component_instance_id:, slot_id:, name:,
                       width_mm:, thickness_mm:, length_mm:,
                       translation:, basis:, aabb_min: nil, aabb_size: nil)
          @component_instance_id = component_instance_id
          @slot_id = slot_id
          @name = name
          @width_mm = width_mm
          @thickness_mm = thickness_mm
          @length_mm = length_mm
          @translation = translation
          @basis = basis
          @aabb_min = aabb_min
          @aabb_size = aabb_size
        end
      end

      # A parsed resolved layout: contract marker + board transforms.
      class NativeLayout
        attr_reader :transform_contract, :boards

        def initialize(transform_contract, boards)
          @transform_contract = transform_contract
          @boards = boards
        end

        def find_board(component_instance_id)
          boards.find { |board| board.component_instance_id == component_instance_id }
        end
      end

      # Parser of the authoritative board-local transform contract (#414 /
      # ADR-0004 §9). The resolved layout publishes, per board:
      #
      #   transformContract: 'granete.local-basis.v1'
      #   components[].localTransform = { translationMm, basis: { x, y, z } }
      #   components[].widthMm/thicknessMm/lengthMm (local box extents:
      #     local X = width, local Y = thickness, local Z = length)
      #
      # with furniture_point = translationMm + basis · local_point for the
      # local box [0,width]×[0,thickness]×[0,length]. The basis is
      # orthonormal and right-handed in the furniture (workshop) frame, so
      # applying it is a pure rigid placement — never a mirror. This parser
      # NEVER derives orientation from slotId, role, name or AABB shape
      # (those cannot recover orientation; see the negative-proof tests) and
      # has NO fallback path: a missing/unknown transform contract or a
      # malformed basis fails loudly so clients never place pieces on a guess.
      module LayoutContract
        SUPPORTED_TRANSFORM_CONTRACT = 'granete.local-basis.v1'
        VECTOR_TOLERANCE = 1e-4

        class ContractError < LayoutResolutionError; end

        module_function

        # Parses and validates a resolved layout body. Raises ContractError
        # (a LayoutResolutionError) on any contract violation.
        def parse!(body)
          raise ContractError, 'Respuesta de composición inválida del servidor' unless body.is_a?(Hash)

          contract = body['transformContract']
          unless contract == SUPPORTED_TRANSFORM_CONTRACT
            raise ContractError,
                  "Contrato de transform no soportado: #{contract.inspect} " \
                  "(esta extensión entiende #{SUPPORTED_TRANSFORM_CONTRACT}). " \
                  'Actualizá la extensión; la orientación no se infiere desde slot/AABB.'
          end

          components = body['components']
          unless components.is_a?(Array) && !components.empty?
            raise ContractError, 'La composición resuelta no trae componentes'
          end

          NativeLayout.new(contract, components.map { |raw| parse_board(raw) })
        end

        def parse_board(raw)
          raise ContractError, 'Componente de composición inválido' unless raw.is_a?(Hash)

          id = raw['componentInstanceId']
          raise ContractError, 'Componente sin componentInstanceId' unless id.is_a?(String) && !id.empty?

          local = raw['localTransform']
          unless local.is_a?(Hash)
            raise ContractError,
                  "Componente #{id}: falta localTransform (contrato #{SUPPORTED_TRANSFORM_CONTRACT})"
          end

          LayoutBoardTransform.new(
            component_instance_id: id,
            slot_id: raw['slotId'],
            name: raw['name'],
            width_mm: positive_number(raw['widthMm'], "widthMm de #{id}"),
            thickness_mm: positive_number(raw['thicknessMm'], "thicknessMm de #{id}"),
            length_mm: positive_number(raw['lengthMm'], "lengthMm de #{id}"),
            translation: numeric_triple(local['translationMm'], "translationMm de #{id}"),
            basis: parse_basis(local['basis'], id),
            aabb_min: optional_triple(raw.dig('transform', 'translationMm'), "AABB min de #{id}"),
            aabb_size: optional_triple(raw['dimensionsMm'], "AABB size de #{id}")
          )
        end

        def parse_basis(raw, id)
          raise ContractError, "Componente #{id}: falta localTransform.basis" unless raw.is_a?(Hash)

          basis = {
            'x' => numeric_triple(raw['x'], "basis.x de #{id}"),
            'y' => numeric_triple(raw['y'], "basis.y de #{id}"),
            'z' => numeric_triple(raw['z'], "basis.z de #{id}")
          }
          validate_basis!(basis, id)
          basis
        end

        # The published orientation contract, enforced client-side too: unit,
        # orthogonal, right-handed (det = +1). A mirrored or collapsed basis
        # would flip/collapse the board in SketchUp — reject, never repair.
        def validate_basis!(basis, id)
          basis.each do |axis, v|
            norm = Math.sqrt(dot(v, v))
            next if (norm - 1.0).abs <= VECTOR_TOLERANCE

            raise ContractError, "Componente #{id}: basis.#{axis} no es unitario (|v|=#{norm})"
          end
          %w[x y z].each do |a|
            %w[x y z].each do |b|
              next if a >= b

              d = dot(basis[a], basis[b])
              next if d.abs <= VECTOR_TOLERANCE

              raise ContractError, "Componente #{id}: basis.#{a}·basis.#{b} = #{d}, no es ortonormal"
            end
          end
          det = dot(basis['x'], cross(basis['y'], basis['z']))
          return if (det - 1.0).abs <= VECTOR_TOLERANCE

          raise ContractError, "Componente #{id}: base no es diestra (det=#{det}); un espejo nunca se aplica"
        end

        def numeric_triple(raw, label)
          unless raw.is_a?(Array) && raw.length == 3 && raw.all?(Numeric)
            raise ContractError, "#{label} debe ser un triple numérico [x, y, z]"
          end

          values = raw.map { |v| Float(v) }
          raise ContractError, "#{label} contiene valores no finitos" unless values.all?(&:finite?)

          values
        end

        def optional_triple(raw, label)
          return nil if raw.nil?

          numeric_triple(raw, label)
        end

        def positive_number(raw, label)
          unless raw.is_a?(Numeric) && Float(raw).finite? && Float(raw).positive?
            raise ContractError, "#{label} debe ser un número positivo"
          end

          Float(raw)
        end

        def dot(vec_a, vec_b)
          (vec_a[0] * vec_b[0]) + (vec_a[1] * vec_b[1]) + (vec_a[2] * vec_b[2])
        end

        def cross(vec_a, vec_b)
          [(vec_a[1] * vec_b[2]) - (vec_a[2] * vec_b[1]),
           (vec_a[2] * vec_b[0]) - (vec_a[0] * vec_b[2]),
           (vec_a[0] * vec_b[1]) - (vec_a[1] * vec_b[0])]
        end
      end
    end
  end
end
