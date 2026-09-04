# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Screen-space proximity picking for overlay markers (#470 §18). Works
      # exclusively on the projected markers (world points) and the view's
      # project() — it never creates picking geometry in the model. A click
      # hits a feature when it lands near the projected ring or inside it;
      # the nearest feature wins.
      module ScreenPicker
        DEFAULT_THRESHOLD_PX = 14

        module_function

        # view must respond to project(point) → [x, y] (SketchUp semantics;
        # returns nil for points behind the camera).
        def pick(click_x, click_y, projected_features, view, threshold: DEFAULT_THRESHOLD_PX)
          best = nil
          best_score = nil
          projected_features.each do |feature|
            screen = screen_geometry(feature, view)
            next if screen.nil?

            score = score_for(click_x, click_y, screen, threshold)
            next if score.nil?

            if best_score.nil? || score < best_score
              best = feature
              best_score = score
            end
          end
          best
        end

        def screen_geometry(feature, view)
          center = view.project(feature.center)
          return nil unless center.is_a?(Array) && center.length >= 2

          ring = feature.ring_points.filter_map { |point| view.project(point) }
          ring.select! { |point| point.is_a?(Array) && point.length >= 2 }
          return nil if ring.empty?

          radius = ring.map do |point|
            Math.sqrt(((point[0] - center[0])**2) + ((point[1] - center[1])**2))
          end.max
          { center: center, ring: ring, radius: radius }
        end

        # 0 when the click falls inside the projected circle; otherwise the
        # distance to the closest ring point; nil when outside the threshold.
        def score_for(click_x, click_y, screen, threshold)
          center_distance = Math.sqrt(
            ((click_x - screen[:center][0])**2) + ((click_y - screen[:center][1])**2)
          )
          return 0.0 if center_distance <= screen[:radius]

          ring_distance = screen[:ring].map do |point|
            Math.sqrt(((click_x - point[0])**2) + ((click_y - point[1])**2))
          end.min
          return nil if ring_distance > threshold

          ring_distance
        end
      end
    end
  end
end
