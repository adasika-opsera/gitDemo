/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-util-to-model',
      severity: 'error',
      comment: 'Utility modules must not import from the model layer',
      from: {
        path: '^app/assets/javascripts/(lib/utils|work_items/(list/)?utils|ee/.*/utils|ce/.*/utils)',
      },
      to: {
        path: '^app/assets/javascripts/.*/model',
      },
    },
    {
      name: 'no-util-to-filter',
      severity: 'error',
      comment: 'Utility modules must not import from the filter layer',
      from: {
        path: '^app/assets/javascripts/(lib/utils|work_items/(list/)?utils|ee/.*/utils|ce/.*/utils)',
      },
      to: {
        path: '^app/assets/javascripts/.*/filter',
      },
    },
    {
      name: 'no-util-to-config',
      severity: 'error',
      comment: 'Utility modules must not import from the config layer',
      from: {
        path: '^app/assets/javascripts/lib/utils',
      },
      to: {
        path: '^app/assets/javascripts/config',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    combinedDependencies: true,
    exclude: {
      path: '^(node_modules|dist|reports|spec|tests|fixtures)',
    },
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
