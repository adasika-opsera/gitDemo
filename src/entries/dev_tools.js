// Dev-only entry — no production assets emitted when tree-shaken in production builds.
if (process.env.NODE_ENV !== 'production') {
  console.log('dev tools');
}
