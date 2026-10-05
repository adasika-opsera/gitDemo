# frozen_string_literal: true

namespace :gitlab do
  namespace :graphql do
    desc 'Publish the GraphQL mutation and field authorization coverage inventory'
    task :authz_coverage do
      require 'gitlab/graphql/authz_coverage'

      root = Gitlab.root
      dump_path = ENV.fetch('GRAPHQL_SCHEMA_DUMP', File.join(root, Gitlab::Graphql::AuthzCoverage::DUMP_RELATIVE))
      output_path = ENV.fetch(
        'GRAPHQL_AUTHZ_COVERAGE_REPORT',
        File.join(root, Gitlab::Graphql::AuthzCoverage::REPORT_RELATIVE)
      )

      report = Gitlab::Graphql::AuthzCoverage.run!(root: root, dump_path: dump_path, output_path: output_path)
      totals = report.fetch('totals')
      puts "Wrote #{output_path}"
      puts "Mutations: #{totals['declared']}/#{totals['mutations']} declared (#{totals['coveragePercent']}%), " \
           "Fields: #{totals['fieldsDeclared']}/#{totals['fields']} declared (#{totals['fieldsCoveragePercent']}%)"
      next unless ENV['GRAPHQL_AUTHZ_COVERAGE_MODE'] == 'guard'

      Gitlab::Graphql::AuthzCoverage::Guard.enforce!(report)
      puts 'Authorization coverage guard passed at 100%.'
    end
  end
end
