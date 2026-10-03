# frozen_string_literal: true

module Gitlab
  # Per-instance memoization. Values live on the object, so they do not
  # survive past the request that created it.
  module StrongMemoize
    def strong_memoize(name)
      return instance_variable_get(name) if instance_variable_defined?(name)

      instance_variable_set(name, yield)
    end
  end
end
