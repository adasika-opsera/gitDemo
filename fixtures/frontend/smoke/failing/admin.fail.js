console.error('simulated admin boot failure');

if (typeof window !== 'undefined') {
  Promise.reject(new Error('lazy route failed to hydrate'));
}
