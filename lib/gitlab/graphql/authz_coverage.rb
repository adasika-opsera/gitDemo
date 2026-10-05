# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'open3'
require 'gitlab'
require 'gitlab/graphql/schema_loader'
require 'gitlab/graphql/authz_coverage/errors'
require 'gitlab/graphql/authz_coverage/collector'
require 'gitlab/graphql/authz_coverage/report_builder'
require 'gitlab/graphql/authz_coverage/report_schema_validator'
require 'gitlab/graphql/authz_coverage/schema_dump_cross_check'
require 'gitlab/graphql/authz_coverage/guard'

module Gitlab
  module Graphql
    module AuthzCoverage
      DUMP_RELATIVE = 'tmp/tests/graphql/gitlab_schema.graphql'
      REPORT_RELATIVE = 'tmp/reports/graphql_authz_coverage.json'
      JSON_SCHEMA_RELATIVE = 'config/schemas/graphql_authz_coverage_report.schema.json'

      def self.dump!(root: Gitlab.root, dump_path: nil)
        dump_path ||= File.join(root, DUMP_RELATIVE)
        schema = SchemaLoader.load!(root)
        sdl = GraphQL::Schema::Printer.print_schema(schema)
        FileUtils.mkdir_p(File.dirname(dump_path))
        File.write(dump_path, sdl)
        dump_path
      end

      def self.run!(root: Gitlab.root, dump_path: nil, output_path: nil, ee: Gitlab.ee?)
        dump_path ||= File.join(root, DUMP_RELATIVE)
        output_path ||= File.join(root, REPORT_RELATIVE)
        Runner.new(root: root, dump_path: dump_path, output_path: output_path, ee: ee).run!
      end

      class Runner
        def initialize(root:, dump_path:, output_path:, ee:)
          @root = root
          @dump_path = dump_path
          @output_path = output_path
          @ee = ee
        end

        def run!
          # Drop any previous artifact before work starts so a failed run cannot
          # leave a stale report that looks like full coverage.
          FileUtils.rm_f(@output_path)

          schema = SchemaLoader.load!(@root)
          SchemaDumpCrossCheck.new(schema: schema, dump_path: @dump_path).verify!
          collected = Collector.new(schema: schema, ee: @ee).collect
          report = ReportBuilder.new(collected).build(git_sha: current_git_sha)
          ReportSchemaValidator.new(schema_path: File.join(@root, JSON_SCHEMA_RELATIVE)).validate!(report)

          FileUtils.mkdir_p(File.dirname(@output_path))
          File.write(@output_path, "#{JSON.pretty_generate(report)}\n")
          report
        end

        private

        def current_git_sha
          stdout, status = Open3.capture2('git', '-C', @root, 'rev-parse', 'HEAD')
          return 'unknown' unless status.success?

          sha = stdout.strip
          sha.empty? ? 'unknown' : sha
        end
      end
    end
  end
end
