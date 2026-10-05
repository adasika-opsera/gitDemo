# frozen_string_literal: true

require 'graphql'
require 'gitlab/graphql/authorize/authorize_resource'

# Independent of app/graphql so unit tests do not load the application schema.
module AuthzCoverageFixtures
  class MiniField < GraphQL::Schema::Field
    def initialize(*args, authorize: nil, public: false, public_reason: nil, **kwargs, &block)
      @required_abilities = Array(authorize).flatten.compact.map(&:to_s)
      @public_data = public == true
      @public_reason = @public_data ? public_reason.to_s : nil
      super(*args, **kwargs, &block)
    end

    attr_reader :required_abilities, :public_reason

    def public_data?
      @public_data
    end
  end

  class MiniObject < GraphQL::Schema::Object
    field_class MiniField
  end

  class MiniMutation < GraphQL::Schema::Mutation
    include Gitlab::Graphql::Authorize::AuthorizeResource
    field_class MiniField
  end

  class WidgetType < MiniObject
    graphql_name 'Widget'
    field :id, GraphQL::Types::ID, null: false, authorize: :read_widget
    field :name, GraphQL::Types::String, null: true, public: true,
      public_reason: 'Widget name is public catalog data.'
    field :note, GraphQL::Types::String, null: true
    field :widget_secret_token, GraphQL::Types::String, null: true
  end

  class CreateWidget < MiniMutation
    graphql_name 'CreateWidget'
    authorize :create_widget
    argument :name, GraphQL::Types::String, required: true
    field :widget, WidgetType, null: true

    def resolve(name:)
      { widget: { 'name' => name } }
    end
  end

  class UpdateWidget < MiniMutation
    graphql_name 'UpdateWidget'
    authorize :read_widget, :update_widget
    argument :id, GraphQL::Types::ID, required: true
    field :widget, WidgetType, null: true, public: true

    def resolve(id:)
      { widget: { 'id' => id } }
    end
  end

  class DestroyWidget < MiniMutation
    graphql_name 'DestroyWidget'
    argument :id, GraphQL::Types::ID, required: true
    field :widget, WidgetType, null: true, public: true

    def resolve(id:)
      { widget: { 'id' => id } }
    end
  end

  class RenameWidgetLegacy < MiniMutation
    graphql_name 'RenameWidgetLegacy'
    authorize :update_widget
    argument :id, GraphQL::Types::ID, required: true
    field :widget, WidgetType, null: true, public: true

    def resolve(id:)
      { widget: { 'id' => id } }
    end
  end

  class ExportWidget < MiniMutation
    graphql_name 'ExportWidget'
    ee_only!
    authorize :admin_widget
    field :exported, GraphQL::Types::Boolean, null: true, public: true

    def resolve
      { exported: true }
    end
  end

  class QueryType < MiniObject
    graphql_name 'Query'
    field :echo, GraphQL::Types::String, null: true, public: true,
      public_reason: 'Echo is a public probe.'
  end

  class MutationType < MiniObject
    graphql_name 'Mutation'
    field :create_widget, mutation: CreateWidget
    field :update_widget, mutation: UpdateWidget
    field :destroy_widget, mutation: DestroyWidget
    field :rename_widget_legacy, mutation: RenameWidgetLegacy, deprecation_reason: 'Use updateWidget'
    field :export_widget, mutation: ExportWidget
  end

  class MiniSchema < GraphQL::Schema
    query QueryType
    mutation MutationType
  end
end
