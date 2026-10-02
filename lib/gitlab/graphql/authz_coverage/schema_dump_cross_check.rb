# frozen_string_literal: true

require 'gitlab/graphql/authz_coverage/errors'

module Gitlab
  module Graphql
    module AuthzCoverage
      class SchemaDumpCrossCheck
        def initialize(schema:, dump_path:)
          @schema = schema
          @dump_path = dump_path
        end

        def verify!
          unless File.file?(@dump_path)
            raise MissingSchemaDumpError, "schema dump artifact is missing: expected #{@dump_path}"
          end

          dumped = mutation_names_from_sdl(File.read(@dump_path))
          live = live_mutation_names
          missing = live - dumped
          extra = dumped - live
          return if missing.empty? && extra.empty?

          raise SchemaDumpMismatchError,
                "schema dump does not match the loaded schema (missing: #{missing.join(', ')}, extra: #{extra.join(', ')})"
        end

        private

        def live_mutation_names
          return [] if @schema.mutation.nil?

          @schema.mutation.fields.keys.map(&:to_s).sort
        end

        def mutation_names_from_sdl(sdl)
          match = sdl.match(/^type Mutation \{$(?<body>.*?)^\}/m)
          raise SchemaDumpMismatchError, 'schema dump has no Mutation type' unless match

          match[:body].lines.filter_map do |line|
            stripped = line.strip
            next if stripped.empty? || stripped.start_with?('#', '"')

            # Field definitions are `name(` or `name:`. Description prose is not.
            stripped[/\A([_A-Za-z][_0-9A-Za-z]*)(?=\s*[\(:])/, 1]
          end.sort
        end
      end
    end
  end
end
