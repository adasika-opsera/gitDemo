# frozen_string_literal: true

module Mutations
  module Issues
    class DestroyIssue < BaseMutation
      graphql_name 'DestroyIssue'
      description 'Destroy an issue'
      # The resolver has no inline check. Sibling issue mutations declare
      # `<verb>_issue`, so the strictest matching ability is destroy_issue.
      authorize :destroy_issue

      argument :iid, GraphQL::Types::ID, required: true

      field :issue, Types::IssueType, null: true

      def resolve(iid:)
        { issue: { 'iid' => iid } }
      end
    end
  end
end
