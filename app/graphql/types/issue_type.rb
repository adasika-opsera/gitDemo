# frozen_string_literal: true

module Types
  class IssueType < BaseObject
    graphql_name 'Issue'
    description 'Representative issue object used to inventory field authorization'

    field :iid, GraphQL::Types::ID, null: false, authorize: :read_issue, description: 'Issue identifier'
    field :title, GraphQL::Types::String, null: true, public: true, description: 'Public issue title'
    field :confidential_note, GraphQL::Types::String, null: true, description: 'Non-public note with no ability declaration'
    field :webhook_secret_token, GraphQL::Types::String, null: true, description: 'Credential-shaped field excluded from the inventory'
  end
end
