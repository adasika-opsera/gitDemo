export function getWorkItem(id) {
  return { id, title: 'Work item' };
}

export function listWorkItems() {
  return [getWorkItem(1)];
}
