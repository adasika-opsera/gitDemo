# frozen_string_literal: true

module Gitlab
  module_function

  def root
    File.expand_path('..', __dir__)
  end

  # CE is the default. EE-only schema members are inventoried only when this is true.
  def ee?
    ENV['GITLAB_EE'] == 'true'
  end
end
