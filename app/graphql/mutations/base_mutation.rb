# frozen_string_literal: true

require 'gitlab/graphql/authorize/authorize_resource'

module Mutations
  class BaseMutation < GraphQL::Schema::Mutation
    include Gitlab::Graphql::Authorize::AuthorizeResource

    field_class Types::BaseField
    object_class Types::BaseObject
  end
end
