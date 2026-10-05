# frozen_string_literal: true

require 'spec_helper'
require 'open3'
require 'json'
require 'tmpdir'
require 'gitlab/graphql/authz_coverage'

RSpec.describe 'gitlab:graphql:authz_coverage' do
  let(:root) { ROOT }
  let(:schema_path) { File.join(root, Gitlab::Graphql::AuthzCoverage::JSON_SCHEMA_RELATIVE) }

  # Invoke rake directly. Nested `bundle exec` exits non-zero on Ruby 4
  # even when the task succeeds, which hides the real status.
  def rake(*tasks, env: {})
    Open3.capture2e(env, 'rake', *tasks, chdir: root)
  end

  it 'runs against the application schema and validates a non-empty report' do
    Dir.mktmpdir do |dir|
      dump = File.join(dir, 'gitlab_schema.graphql')
      report_path = File.join(dir, 'graphql_authz_coverage.json')
      env = { 'GRAPHQL_SCHEMA_DUMP' => dump, 'GRAPHQL_AUTHZ_COVERAGE_REPORT' => report_path }

      stdout, status = rake('gitlab:graphql:schema:dump', 'gitlab:graphql:authz_coverage', env: env)

      expect(status).to be_success, stdout
      expect(File.file?(report_path)).to be(true)
      expect(File.size(report_path)).to be < 1_000_000

      report = JSON.parse(File.read(report_path))
      Gitlab::Graphql::AuthzCoverage::ReportSchemaValidator.new(schema_path: schema_path).validate!(report)

      expect(report['totals']['mutations']).to be > 0
      expect(report['mutations'].map { |entry| entry['name'] }).to include('CreateIssue', 'DestroyIssue', 'UpdateIssue', 'CloseIssue')
      destroy_issue = report['mutations'].find { |entry| entry['name'] == 'DestroyIssue' }
      expect(destroy_issue).to include('declared' => true, 'abilities' => ['destroy_issue'])
      expect(report['mutations'].find { |entry| entry['name'] == 'UpdateIssue' }['abilities']).to eq(%w[read_issue update_issue])
      expect(report['totals']['coveragePercent']).to eq(100.0)
      expect(report['totals']['fieldsCoveragePercent']).to eq(100.0)
      expect(report['eeOnlyExcluded']).to eq(['ExportAuditEvents'])
      confidential = report['fields'].find { |entry| entry['name'] == 'Issue.confidentialNote' }
      expect(confidential).to include('declared' => true, 'abilities' => ['read_issue'])
      expect(report['fields'].map { |entry| entry['name'] }).to include('Issue.iid')
      expect(report['fields'].map { |entry| entry['name'] }).not_to include('Issue.title')
      expect(report['publicFields']).to include(
        'name' => 'Issue.title',
        'owner' => 'Issue',
        'reason' => 'Issue titles are visible without an ability check.'
      )
      expect(report['publicFields'].map { |entry| entry['reason'] }).to all(match(/\S/))
      expect(JSON.generate(report)).not_to include('secret')
      expect(JSON.generate(report)).not_to include('webhookSecretToken')
    end
  end

  it 'fails with the expected dump path and does not write a report when the dump is missing' do
    Dir.mktmpdir do |dir|
      dump = File.join(dir, 'missing', 'gitlab_schema.graphql')
      report_path = File.join(dir, 'graphql_authz_coverage.json')
      stdout, status = rake(
        'gitlab:graphql:authz_coverage',
        env: { 'GRAPHQL_SCHEMA_DUMP' => dump, 'GRAPHQL_AUTHZ_COVERAGE_REPORT' => report_path }
      )

      expect(status).not_to be_success
      expect(stdout).to include("schema dump artifact is missing: expected #{dump}")
      expect(File.file?(report_path)).to be(false)
    end
  end

  it 'does not write a report when the dump does not match the loaded schema' do
    Dir.mktmpdir do |dir|
      dump = File.join(dir, 'gitlab_schema.graphql')
      report_path = File.join(dir, 'graphql_authz_coverage.json')
      env = { 'GRAPHQL_SCHEMA_DUMP' => dump, 'GRAPHQL_AUTHZ_COVERAGE_REPORT' => report_path }

      _stdout, dump_status = rake('gitlab:graphql:schema:dump', env: env)
      expect(dump_status).to be_success, _stdout

      File.write(dump, File.read(dump).sub('createIssue', 'renamedIssue'))
      stdout, status = rake('gitlab:graphql:authz_coverage', env: env)

      expect(status).not_to be_success
      expect(stdout).to include('schema dump does not match the loaded schema')
      expect(File.file?(report_path)).to be(false)
    end
  end
end
