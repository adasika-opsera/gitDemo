# frozen_string_literal: true

require_relative 'application_controller'

lib_path = File.expand_path('../../lib', __dir__)
$LOAD_PATH.unshift(lib_path) unless $LOAD_PATH.include?(lib_path)

require 'gitlab/graphql/request_classification/request_classifier'

class GraphqlController < ApplicationController
  skip_before_action :authenticate_user!
  skip_before_action :active_user_check
  skip_before_action :enforce_read_only_organization
  skip_before_action :verify_authenticity_token, if: -> { request_classifier.skip_csrf? }
  skip_before_action :check_two_factor_requirement, if: -> { request_classifier.skip_two_factor? }

  def request_classifier
    @request_classifier ||= Gitlab::Graphql::RequestClassification::RequestClassifier.new(
      params: params,
      current_user: current_user,
      sessionless: sessionless_user?
    )
  end
end
