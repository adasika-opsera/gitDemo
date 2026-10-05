# frozen_string_literal: true

require 'gitlab/graphql/authz_coverage/errors'

module Gitlab
  module Graphql
    module AuthzCoverage
      # Fails closed unless every mutation and non-public field declares an ability.
      class Guard
        MUTATION_DECLARATION = 'authorize :ability_name'
        FIELD_DECLARATION = 'field :name, Type, null: true, authorize: :ability_name'

        def self.enforce!(report)
          offenders = list(report)
          return report if offenders.empty?

          lines = offenders.map { |offender| format_offender(offender) }
          raise GuardError, "authorization coverage is below 100%:\n#{lines.join("\n")}"
        end

        def self.list(report)
          raise GuardError, 'coverage report is missing; refusing to report zero offenders' if report.nil?

          mutations = report['mutations']
          fields = report['fields']
          incomplete = !mutations.is_a?(Array) || !fields.is_a?(Array)
          raise GuardError, 'coverage report is incomplete; refusing to report partial coverage' if incomplete

          collect_offenders(mutations, fields)
        end

        def self.collect_offenders(mutations, fields)
          offenders = []
          mutations.each { |entry| append_mutation(offenders, entry) }
          fields.each { |entry| append_field(offenders, entry) }
          offenders
        end

        def self.append_mutation(offenders, entry)
          return if entry['declared']

          offenders << offender('Mutation', entry['name'], 'mutation', MUTATION_DECLARATION)
        end

        def self.append_field(offenders, entry)
          return if entry['declared']

          offenders << offender(entry['owner'], entry['name'], 'non-public field', FIELD_DECLARATION)
        end

        def self.offender(type_name, field_name, kind, declaration)
          {
            'type' => type_name.to_s,
            'field' => field_name.to_s,
            'kind' => kind,
            'declaration' => declaration
          }
        end

        def self.format_offender(offender)
          "type=#{offender['type']} field=#{offender['field']} " \
            "kind=#{offender['kind']} declaration=#{offender['declaration']}"
        end

        private_class_method :collect_offenders, :append_mutation, :append_field, :offender, :format_offender
      end
    end
  end
end
