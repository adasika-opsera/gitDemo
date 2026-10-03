# frozen_string_literal: true

require 'gitlab/graphql/schema_loader'

module Gitlab
  module Graphql
    module Authz
      # Reads required abilities from the schema's AuthorizeResource metadata.
      # Schema structure is cached; ability decisions are not.
      class DeclarationLookup
        def self.schema
          @schema ||= Gitlab::Graphql::SchemaLoader.load!
        end

        def initialize(schema: self.class.schema)
          @schema = schema
        end

        def for_selection(operation_type, selection_name)
          name = selection_name.to_s
          return entry(:introspection, []) if name.start_with?('__')

          field = fields_for(operation_type)[name]
          return entry(:undeclared, []) if field.nil?

          if operation_type == 'mutation'
            mutation = field.respond_to?(:mutation) ? field.mutation : nil
            abilities = abilities_from(mutation)
            kind = abilities.empty? ? :undeclared : :declared
            entry(kind, abilities, expects_subject: expects_subject?(mutation))
          elsif field.respond_to?(:public_data?) && field.public_data?
            entry(:public, [])
          else
            abilities = field.respond_to?(:required_abilities) ? Array(field.required_abilities).map(&:to_s) : []
            kind = abilities.empty? ? :undeclared : :declared
            entry(kind, abilities)
          end
        end

        private

        def entry(kind, abilities, expects_subject: false)
          { kind: kind, abilities: abilities, expects_subject: expects_subject }
        end

        def abilities_from(mutation)
          return [] unless mutation.respond_to?(:required_abilities)

          Array(mutation.required_abilities).map(&:to_s)
        end

        def expects_subject?(mutation)
          return false unless mutation.respond_to?(:arguments)

          mutation.arguments.any? { |name, _argument| name.to_s == 'iid' }
        end

        def fields_for(operation_type)
          type = operation_type == 'mutation' ? @schema.mutation : @schema.query
          type.fields.each_with_object({}) do |(key, field), acc|
            acc[key.to_s] = field
            acc[field.graphql_name.to_s] = field if field.respond_to?(:graphql_name)
          end
        end
      end
    end
  end
end
