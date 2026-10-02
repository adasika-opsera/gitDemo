# frozen_string_literal: true

require 'time'

module Gitlab
  module Graphql
    module AuthzCoverage
      class ReportBuilder
        def initialize(collected)
          @collected = collected
        end

        def build(git_sha:, generated_at: Time.now.utc.iso8601)
          mutations = @collected.fetch(:mutations)
          fields = @collected.fetch(:fields)
          mutation_declared = mutations.count { |entry| entry['declared'] }
          field_declared = fields.count { |entry| entry['declared'] }
          overall_declared = mutation_declared + field_declared
          overall_total = mutations.length + fields.length

          {
            'generatedAt' => generated_at,
            'gitSha' => git_sha,
            'edition' => @collected.fetch(:edition),
            'eeOnlyExcluded' => @collected.fetch(:ee_only_excluded),
            'totals' => {
              'mutations' => mutations.length,
              'declared' => mutation_declared,
              'undeclared' => mutations.length - mutation_declared,
              'coveragePercent' => percent(mutation_declared, mutations.length),
              'fields' => fields.length,
              'fieldsDeclared' => field_declared,
              'fieldsUndeclared' => fields.length - field_declared,
              'fieldsCoveragePercent' => percent(field_declared, fields.length),
              'overallCoveragePercent' => percent(overall_declared, overall_total),
              'redactedFieldCount' => @collected.fetch(:redacted_field_count)
            },
            'mutations' => mutations,
            'fields' => fields
          }
        end

        private

        def percent(declared_count, total)
          return 100.0 if total.zero?

          ((declared_count.to_f / total) * 100).round(1)
        end
      end
    end
  end
end
