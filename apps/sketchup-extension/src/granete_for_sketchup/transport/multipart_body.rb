# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Transport
      # Streams a multipart/form-data body for Net::HTTP without loading the
      # whole file into memory: `read` hands Net::HTTP the boundary/preamble
      # chunks, the file in bounded chunks, then the closing boundary.
      # Stdlib ships no multipart writer, and a design model artifact can be
      # hundreds of megabytes — this keeps the publish upload memory-flat.
      class MultipartBody
        DEFAULT_CHUNK = 64 * 1024

        def initialize(boundary:, field:, filename:, content_type:, file:)
          preamble = "--#{boundary}\r\n"
          preamble << "Content-Disposition: form-data; name=\"#{field}\"; filename=\"#{filename}\"\r\n"
          preamble << "Content-Type: #{content_type}\r\n\r\n"
          closing = "\r\n--#{boundary}--\r\n"
          # [kind, payload, bytes_already_consumed]
          @segments = [
            [:bytes, preamble.dup, 0],
            [:file, file, 0],
            [:bytes, closing.dup, 0]
          ]
          @length = preamble.bytesize + File.size(file) + closing.bytesize
          @index = 0
        end

        def content_length
          @length
        end

        # Net::HTTP streams any body object responding to read(length[, buffer]).
        # rubocop:disable-next Metrics/AbcSize
        def read(length = nil, buffer = nil)
          buffer ||= +''
          buffer.clear
          wanted = length.nil? ? @length : length

          while buffer.bytesize < wanted && @index < @segments.length
            segment = @segments[@index]
            take = wanted - buffer.bytesize
            case segment[0]
            when :bytes
              chunk = segment[1].byteslice(segment[2], take).to_s
              buffer << chunk
              segment[2] += chunk.bytesize
              @index += 1 if segment[2] >= segment[1].bytesize
            when :file
              chunk = segment[1].read([take, DEFAULT_CHUNK].min)
              if chunk.nil? || chunk.empty?
                @index += 1
              else
                buffer << chunk
                segment[2] += chunk.bytesize
              end
            end
          end
          buffer.empty? && !length.nil? ? nil : buffer
        end
      end
    end
  end
end
