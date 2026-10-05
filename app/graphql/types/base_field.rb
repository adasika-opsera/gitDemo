# frozen_string_literal: true

module Types
  class BaseField < GraphQL::Schema::Field
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
end
