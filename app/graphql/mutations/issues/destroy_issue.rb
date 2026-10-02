# frozen_string_literal: true

module Mutations
  module Issues
    class DestroyIssue < BaseMutation
      graphql_name 'DestroyIssue'
      description 'Destroy an issue. Deliberately undeclared so the inventory records the gap.'

      argument :iid, GraphQL::Types::ID, required: true

      field :issue, Types::IssueType, null: true

      def resolve(iid:)
        { issue: { 'iid' => iid } }
      end
    end
  end
end
