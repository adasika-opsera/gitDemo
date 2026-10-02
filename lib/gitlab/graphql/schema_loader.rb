# frozen_string_literal: true

require 'graphql'
require 'gitlab'

module Gitlab
  module Graphql
    # This repository has no Zeitwerk/Rails autoloader. Load the schema in
    # dependency order so rake tasks and specs can require it explicitly.
    module SchemaLoader
      FILES = %w[
        app/graphql/types/base_field.rb
        app/graphql/types/base_object.rb
        app/graphql/mutations/base_mutation.rb
        app/graphql/types/issue_type.rb
        app/graphql/mutations/issues/create_issue.rb
        app/graphql/mutations/issues/update_issue.rb
        app/graphql/mutations/issues/destroy_issue.rb
        app/graphql/mutations/issues/close_issue.rb
        app/graphql/mutations/ee/audit_events/export_audit_events.rb
        app/graphql/types/query_type.rb
        app/graphql/types/mutation_type.rb
        app/graphql/gitlab_schema.rb
      ].freeze

      def self.load!(root = Gitlab.root)
        FILES.each do |relative|
          require File.join(root, relative)
        end

        GitlabSchema
      end
    end
  end
end
