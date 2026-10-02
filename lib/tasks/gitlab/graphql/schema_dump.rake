# frozen_string_literal: true

namespace :gitlab do
  namespace :graphql do
    namespace :schema do
      desc 'Dump the GraphQL schema to tmp/tests/graphql/gitlab_schema.graphql'
      task :dump do
        require 'gitlab/graphql/authz_coverage'

        root = Gitlab.root
        dump_path = ENV.fetch('GRAPHQL_SCHEMA_DUMP', File.join(root, Gitlab::Graphql::AuthzCoverage::DUMP_RELATIVE))
        written = Gitlab::Graphql::AuthzCoverage.dump!(root: root, dump_path: dump_path)
        puts "Wrote #{written}"
      end
    end
  end
end
