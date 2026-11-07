export function create() {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)),
    value => value.toString(16).padStart(8, '0')).join('');
}

export function subscription(user, cached = {}) {
  if (user.id && cached.id && user.id.replace(/\(\d+\)$/, '') !== cached.id.replace(/\(\d+\)$/, '')) {
    return { ...user };
  }
  const result = { ...cached, ...user };
  result.tier = user.tier ?? cached.tier;
  if (!result.tier) return { ...result, month: 0, total: 0, tierUrl: '' };
  if (cached.tier !== result.tier) return result;
  if (!(user.month > 0)) result.month = cached.month || 0;
  if (cached.total > (user.total || 0)) {
    result.total = cached.total;
    result.tierUrl = cached.tierUrl || user.tierUrl || '';
  }
  else if (!user.tierUrl) result.tierUrl = cached.tierUrl || '';
  return result;
}
