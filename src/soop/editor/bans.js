const cache = new Map();

export async function get(user, offset = 0) {
  const id = String(user || '').replace(/\(\d+\)$/, '');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new Error('시청자를 확인해주세요.');
  }
  const key = `${id}:${offset}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.date < 60000) return saved.value;
  const url = new URL(`/api/ban-tracker/viewer/soop/${encodeURIComponent(id)}`, 'https://weflview.com');
  url.search = new URLSearchParams({ period: 'all', penalty: 'all', eventOffset: String(offset), eventLimit: '10' });
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error('제재내역을 불러오지 못했습니다.');
  const data = await response.json();
  if (!Array.isArray(data.events)) throw new Error('제재내역 응답을 확인할 수 없습니다.');
  const value = {
    url: `https://weflview.com/ban-tracker/viewer/soop/${encodeURIComponent(id)}`,
    summary: data.summary || {},
    entries: data.events.map(event => ({
      id: String(event.id || ''),
      type: event.eventType === 'ban' ? '강제 퇴장' : event.eventType === 'block' ? '채팅 금지' : '제재',
      date: event.eventTime,
      channel: event.channelName || event.channelId || '',
      actor: event.actorNickname || event.actorUserId || '',
      actorId: event.actorUserId || '',
      duration: Number(event.durationSeconds) || 0,
      messages: Array.isArray(event.chatMessages) ? event.chatMessages.map(item => ({
        date: item.time, message: String(item.message || '')
      })) : []
    })),
    cursor: data.pagination?.hasMore && data.events.length ? offset + data.events.length : null
  };
  cache.set(key, { date: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}
