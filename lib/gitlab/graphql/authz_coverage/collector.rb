# frozen_string_literal: true

require 'gitlab/graphql/authz_coverage/errors'

module Gitlab
  module Graphql
    module AuthzCoverage
      class Collector
        CREDENTIAL_NAME = /token|secret|password|credential|api_key/i

        def initialize(schema:, ee: Gitlab.ee?)
          @schema = schema
          @ee = ee
        end

        def collect
          raise TraversalError, 'schema is missing; refusing to emit a partial inventory' if @schema.nil?
          raise TraversalError, 'schema has no mutation type; refusing to emit an empty inventory' if @schema.mutation.nil?

          {
            mutations: collect_mutations,
            fields: collect_fields.fetch(:fields),
            ee_only_excluded: @ee_only_excluded,
            redacted_field_count: @redacted_field_count,
            edition: @ee ? 'ee' : 'ce'
          }
        end

        private

        def collect_mutations
          @ee_only_excluded = []

          @schema.mutation.fields.each_value.sort_by(&:graphql_name).filter_map do |field|
            mutation_class = mutation_class_for(field)
            if mutation_class.nil?
              raise TraversalError,
                    "mutation #{field.graphql_name} has no resolver; refusing to emit a partial inventory"
            end

            name = mutation_name(field, mutation_class)
            if ee_only?(mutation_class) && !@ee
              @ee_only_excluded << name
              next
            end

            abilities = extract_abilities(mutation_class)
            reject_credential_abilities!(abilities, name)
            entry(name, abilities, deprecated?(field))
          end
        end

        def collect_fields
          @redacted_field_count = 0
          fields = []

          object_types.each do |type|
            type.fields.each_value do |field|
              next unless inventory_field?(field)

              if credential_like?(field)
                @redacted_field_count += 1
                next
              end

              next if field.public_data?

              abilities = Array(field.required_abilities).map(&:to_s)
              name = "#{type.graphql_name}.#{field.graphql_name}"
              reject_credential_abilities!(abilities, name)
              fields << entry(name, abilities, deprecated?(field)).merge('owner' => type.graphql_name)
            end
          end

          { fields: fields.sort_by { |field| field['name'] } }
        end

        def object_types
          types = @schema.types
          types = types.values if types.respond_to?(:values)
          types.select do |type|
            type.is_a?(Class) &&
              type < GraphQL::Schema::Object &&
              !type.introspection? &&
              type != @schema.mutation &&
              !type.graphql_name.end_with?('Payload')
          end
        end

        def inventory_field?(field)
          field.respond_to?(:public_data?) && field.respond_to?(:required_abilities)
        end

        def mutation_name(field, mutation_class)
          if mutation_class.respond_to?(:graphql_name) && !mutation_class.graphql_name.to_s.empty?
            return mutation_class.graphql_name
          end

          field.graphql_name
        end

        def mutation_class_for(field)
          return field.mutation if field.respond_to?(:mutation) && field.mutation
          return field.resolver if field.respond_to?(:resolver) && field.resolver.is_a?(Class)

          nil
        end

        def ee_only?(mutation_class)
          mutation_class.respond_to?(:ee_only?) && mutation_class.ee_only?
        end

        def extract_abilities(mutation_class)
          return [] unless mutation_class.respond_to?(:required_abilities)

          Array(mutation_class.required_abilities).map(&:to_s)
        end

        def credential_like?(field)
          [field.graphql_name, field.name].any? { |name| name.to_s.match?(CREDENTIAL_NAME) }
        end

        def reject_credential_abilities!(abilities, owner)
          leaked = abilities.find { |ability| ability.match?(CREDENTIAL_NAME) }
          return if leaked.nil?

          raise TraversalError, "ability on #{owner} is credential-shaped and cannot be inventoried"
        end

        def deprecated?(field)
          !field.deprecation_reason.nil?
        end

        def entry(name, abilities, deprecated)
          {
            'name' => name,
            'abilities' => abilities,
            'declared' => !abilities.empty?,
            'deprecated' => deprecated
          }
        end
      end
    end
  end
end
