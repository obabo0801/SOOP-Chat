export function transient(error) {
  const codes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH',
    'EHOSTUNREACH', 'EAI_AGAIN', 'CHAT_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'];
  for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    if (['TimeoutError', 'AbortError'].includes(current.name) || codes.includes(current.code)) return true;
    const message = typeof current === 'string' ? current : current.message || '';
    if (/^(?:SOOP 응답 시간 초과(?: \([^)]*\))?|fetch failed|연결 취소|채팅 연결 시간 초과|패키지 (?:연결 실패|응답 시간 초과)|The operation was aborted due to timeout)$/.test(message)) return true;
  }
  return false;
}
