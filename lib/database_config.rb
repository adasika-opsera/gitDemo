# frozen_string_literal: true

module DatabaseConfig
  module_function

  def load
    {
      adapter: 'postgresql',
      host: 'localhost'
    }
  end
end
