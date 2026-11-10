# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Host smoke for the project grip bridge (#1535, ADR-0009 A2.3): the
# INSTALLED extension answering the five acceptance flows at the bridge
# level — style intent without selection, per-furniture exception, one
# operation for N furniture, undo/redo replay — over a REAL SketchUp model
# with the binding dictionary seeded, and a RECORDING service standing in
# for the server (the plugin transports intent; the assertions pin what it
# sends and what it relays back, never a resolution computed locally).
module Granete
  module SketchUpExtension
    class TC_ProjectGripSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      PROJECT_ID = '73551111-1111-4111-8111-111111111111'
      DESIGN_ID = '73552222-2222-4222-8222-222222222222'
      STYLE_A = '73553333-3333-4333-8333-333333333331'
      STYLE_B = '73553333-3333-4333-8333-333333333332'
      INSTANCE_A = '73554444-4444-4444-8444-444444444441'
      INSTANCE_B = '73554444-4444-4444-8444-444444444442'
      INSTANCE_C = '73554444-4444-4444-8444-444444444443'
      DICTIONARY = 'com.granete.project'
      BINDING_KEY = 'granete.project-binding.v1'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        extension = self.class.installed_extension
        flunk 'la extensión Granete no está instalada y cargada en el host' unless extension
        flunk 'la extensión Granete no está habilitada' unless extension.loaded?

        @model = Sketchup.active_model
        seed_binding
        @dialog = FakeDialog.new
        @service = RecordingService.new
        @probe = GripBridgeProbe.new(model: @model, service: @service)
        @probe.register_project_grip_callbacks(@dialog)
        @answers = @probe.answers
      end

      def teardown
        clear_binding
      end

      # 1. Sin selección: la intención de estilo viaja con la versión del
      #    último GET (If-Match) y queda deshacible en la sesión.
      def test_style_intent_without_selection_carries_version_and_is_undoable
        get_grip(grip_version: 12, style_id: STYLE_A)
        @probe.handle_apply_project_grip_style(@dialog,
                                               request(payload: { gripStyleId: STYLE_B, previousStyleId: STYLE_A }))
        applied = @answers['onProjectGripApplied'].last
        assert_equal 'ok', applied['status']
        put = @service.puts.last
        assert_equal :put_project_grip_style, put[:method]
        assert_equal STYLE_B, put[:style_id]
        assert_equal 12, put[:expected_version], 'If-Match = la versión del último GET'
        assert applied['canUndo'], 'the change is undoable in-session'

        # Deshacer: re-aplica el estilo ANTERIOR con la versión del PUT.
        undo_version = 13
        @service.next_put_version = undo_version
        @probe.handle_undo_project_grip(@dialog, request)
        undone = @answers['onProjectGripUndone'].last
        assert_equal 'ok', undone['status']
        assert_equal STYLE_A, @service.puts.last[:style_id], 'undo re-applies the previous style'
        assert_equal undo_version, @service.puts.last[:expected_version], 'undo carries the fresh version'

        # Rehacer: re-aplica la que el deshacer reemplazó.
        @probe.handle_redo_project_grip(@dialog, request)
        assert_equal STYLE_B, @service.puts.last[:style_id], 'redo re-applies the replaced style'
      end

      # 2. Con un mueble: la excepción viaja como override de UNA instancia.
      def test_furniture_exception_travels_for_one_instance
        get_grip(grip_version: 3, style_id: STYLE_A)
        overrides = [{ 'furnitureInstanceId' => INSTANCE_A, 'gripStyleId' => STYLE_B }]
        @probe.handle_apply_project_grip_furniture(@dialog, request(payload: { overrides: overrides }))
        applied = @answers['onProjectGripApplied'].last
        assert_equal 'ok', applied['status']
        put = @service.puts.last
        assert_equal :put_project_grip_furniture, put[:method]
        assert_equal overrides, put[:overrides]
        assert_equal 3, put[:expected_version]
      end

      # 3. Varios muebles: N excepciones en UNA operación.
      def test_batch_exception_is_one_operation_for_all_members
        get_grip(grip_version: 5, style_id: nil)
        overrides = [INSTANCE_A, INSTANCE_B, INSTANCE_C].map do |instance|
          { 'furnitureInstanceId' => instance, 'gripStyleId' => STYLE_B }
        end
        @probe.handle_apply_project_grip_furniture(@dialog, request(payload: { overrides: overrides }))
        applied = @answers['onProjectGripApplied'].last
        assert_equal 'ok', applied['status']
        put = @service.puts.last
        assert_equal 3, put[:overrides].length, 'the three exceptions ride ONE operation'
        assert_equal 5, put[:expected_version]
      end

      # 4. Respuestas tardías: una respuesta de OTRO proyecto nunca llega
      #    al dialog (el estado está indexado por proyecto).
      def test_foreign_project_answers_never_reach_the_dialog
        get_grip(grip_version: 2, style_id: STYLE_A)
        foreign = request(payload: { projectId: '73559999-9999-4999-8999-999999999999' })
        @probe.handle_get_project_grip(@dialog, foreign)
        answer = @answers['onProjectGrip'].last
        assert_equal 'stale_binding', answer['status'], 'a foreign project is refused at the bridge'
        assert_equal 1, @answers['onProjectGrip'].count { |a| a['status'] == 'ok' },
                     'no foreign state ever lands as ok'
      end

      # 5. Sin binding: el bridge falla cerrado con el motivo del taller.
      def test_unbound_model_refuses_with_workshop_reason
        clear_binding
        @probe.handle_get_project_grip(@dialog, request)
        answer = @answers['onProjectGrip'].last
        assert_equal 'unbound', answer['status']
        assert_equal 'conectá este modelo a un proyecto primero', answer['reason']
      end

      # ——— helpers ———

      class FakeDialog
        attr_reader :callbacks

        def initialize
          @callbacks = {}
        end

        def add_action_callback(name, &block)
          @callbacks[name] = block
        end
      end

      class RecordingService
        attr_reader :puts
        attr_accessor :next_put_version, :get_version, :get_style_id

        def initialize
          @puts = []
          @next_put_version = nil
          @get_version = 12
          @get_style_id = TC_ProjectGripSmoke::STYLE_A
        end

        def get_project_grip(_project_id)
          { 'projectId' => TC_ProjectGripSmoke::PROJECT_ID, 'gripVersion' => @get_version,
            'gripStyleId' => @get_style_id, 'snapshot' => {}, 'overrides' => [] }
        end

        def put_project_grip_style(_project_id, style_id, expected_version:)
          @puts.push({ method: :put_project_grip_style, style_id: style_id, expected_version: expected_version })
          { 'projectId' => TC_ProjectGripSmoke::PROJECT_ID, 'gripVersion' => @next_put_version || 13,
            'gripStyleId' => style_id, 'snapshot' => {}, 'overrides' => [] }
        end

        def put_project_grip_furniture(_project_id, overrides, expected_version:)
          @puts.push({ method: :put_project_grip_furniture, overrides: overrides,
                       expected_version: expected_version })
          { 'projectId' => TC_ProjectGripSmoke::PROJECT_ID, 'gripVersion' => @next_put_version || 13,
            'gripStyleId' => TC_ProjectGripSmoke::STYLE_A, 'snapshot' => {}, 'overrides' => overrides }
        end

        def fetch_grip_styles
          []
        end
      end

      # The bridge is module functions over @project_furniture_placer,
      # @logger, execute_bridge and active_model — a probe binds them to the
      # real host model with a recording service.
      class GripBridgeProbe
        include Granete::SketchUpExtension::UserInterface::ProjectGripBridge

        attr_reader :answers, :model

        def initialize(model:, service:)
          @model = model
          @answers = Hash.new { |hash, key| hash[key] = [] }
          @logger = Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
          @project_furniture_placer = PlacerStub.new(service)
        end

        def execute_bridge(_dialog, name, payload)
          @answers[name].push(payload)
          payload
        end

        def active_model
          @model
        end

        class PlacerStub
          attr_reader :service

          def initialize(service)
            @service = service
          end
        end
      end

      private

      def get_grip(grip_version:, style_id:)
        # A REAL GET through the bridge: the service answers with the given
        # version and the bridge arms its If-Match memory from the answer.
        @service.get_version = grip_version
        @service.get_style_id = style_id
        @probe.handle_get_project_grip(@dialog, request)
        answer = @answers['onProjectGrip'].last
        flunk "el GET inicial no respondió ok: #{answer.inspect}" unless answer['status'] == 'ok'
      end

      def request(payload: {})
        JSON.generate({ 'requestId' => "req-#{Time.now.to_f}", 'projectId' => PROJECT_ID }.merge(payload))
      end

      def seed_binding
        binding_payload = {
          'projectId' => PROJECT_ID, 'designId' => DESIGN_ID,
          'baseRevisionId' => '73553333-3333-4333-8333-333333333339', 'schemaVersion' => 1
        }
        @model.set_attribute(DICTIONARY, BINDING_KEY, JSON.generate(binding_payload))
      end

      def clear_binding
        # Host quirk: Model#delete_attribute leaves the value; an EMPTY
        # string is the store's absence (read treats blank as nil).
        @model.set_attribute(DICTIONARY, BINDING_KEY, '')
      end
    end
  end
end
