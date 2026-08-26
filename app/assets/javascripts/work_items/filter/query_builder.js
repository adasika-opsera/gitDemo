export function buildFilterQuery(tokens) {
  return tokens.join(' AND ');
}
