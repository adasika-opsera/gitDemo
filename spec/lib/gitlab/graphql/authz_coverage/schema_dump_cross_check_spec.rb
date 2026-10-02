# frozen_string_literal: true

require 'spec_helper'
require 'tmpdir'
require 'gitlab/graphql/authz_coverage/schema_dump_cross_check'
require_relative '../../../../fixtures/graphql/authz_coverage/mini_schema'

RSpec.describe Gitlab::Graphql::AuthzCoverage::SchemaDumpCrossCheck do
  let(:schema) { AuthzCoverageFixtures::MiniSchema }

  def check(path)
    described_class.new(schema: schema, dump_path: path).verify!
  end

  it 'accepts a dump whose Mutation type matches the loaded schema' do
    Dir.mktmpdir do |dir|
      path = File.join(dir, 'gitlab_schema.graphql')
      File.write(path, GraphQL::Schema::Printer.print_schema(schema))
      expect { check(path) }.not_to raise_error
    end
  end

  it 'names the expected path when the dump artifact is missing' do
    path = '/tmp/does-not-exist/gitlab_schema.graphql'
    expect { check(path) }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::MissingSchemaDumpError, /expected #{Regexp.escape(path)}/)
  end

  it 'fails when the dump mutation set does not match the loaded schema' do
    Dir.mktmpdir do |dir|
      path = File.join(dir, 'gitlab_schema.graphql')
      sdl = GraphQL::Schema::Printer.print_schema(schema).sub('createWidget', 'renamedWidget')
      File.write(path, sdl)

      expect { check(path) }
        .to raise_error(Gitlab::Graphql::AuthzCoverage::SchemaDumpMismatchError, /missing: createWidget/)
    end
  end

  it 'ignores description prose inside the Mutation type' do
    sdl = <<~GRAPHQL
      type Mutation {
        """
        Create an issue
        """
        createWidget(name: String!): CreateWidgetPayload
        """
        Update an issue
        """
        updateWidget(id: ID!): UpdateWidgetPayload
        """
        Destroy an issue
        """
        destroyWidget(id: ID!): DestroyWidgetPayload
        """
        Deprecated close mutation
        """
        renameWidgetLegacy(id: ID!): RenameWidgetLegacyPayload
        """
        EE-only audit export
        """
        exportWidget: ExportWidgetPayload
      }
    GRAPHQL

    Dir.mktmpdir do |dir|
      path = File.join(dir, 'gitlab_schema.graphql')
      File.write(path, sdl)
      expect { check(path) }.not_to raise_error
    end
  end

  it 'fails when the dump has no Mutation type' do
    Dir.mktmpdir do |dir|
      path = File.join(dir, 'gitlab_schema.graphql')
      File.write(path, "type Query {\n  echo: String\n}\n")

      expect { check(path) }
        .to raise_error(Gitlab::Graphql::AuthzCoverage::SchemaDumpMismatchError, /no Mutation type/)
    end
  end
end
