# frozen_string_literal: true

module Types
  class BaseField < GraphQL::Schema::Field
    def initialize(*args, authorize: nil, public: false, **kwargs, &block)
      @required_abilities = Array(authorize).flatten.compact.map(&:to_s)
      @public_data = public == true
      super(*args, **kwargs, &block)
    end

    attr_reader :required_abilities

    def public_data?
      @public_data
    end
  end
end
