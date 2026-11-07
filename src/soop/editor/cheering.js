export function createCheering(request, show, preview, compose, find = id => document.getElementById(id)) {
  const $ = find;
  const dialog = $('chat-cheer');
  let scope = { player: '', account: '' };
  let revision = '';
  let version = 0;
  let timer;
  let busy = false;
  let status = {};
  let loaded = false;
  const key = value => `${value.player}:${value.account}`;
  const fields = ['mode', 'text', 'order', 'interval', 'variance', 'countVariance', 'duration'];
  const read = () => ({
    mode: $('cheer-mode').value,
    text: $('cheer-mode').value === 'single' ? $('cheer-text').value : '',
    pattern: $('cheer-mode').value === 'pattern'
      ? $('cheer-text').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [],
    order: $('cheer-order').value,
    ...Object.fromEntries(['interval', 'variance', 'countVariance', 'duration']
      .map(field => [field, Number($('cheer-' + field).value)]))
  });
  const controls = () => {
    const locked = busy || status.running || !scope.account || !loaded;
    for (const field of fields) $('cheer-' + field).disabled = locked;
    $('cheer-import').disabled = locked;
    $('cheer-save').disabled = locked;
    const config = read();
    const empty = config.mode === 'single' ? !config.text.trim() : !config.pattern.length;
    $('cheer-start').disabled = locked || !status.allowed || empty;
    $('cheer-stop').disabled = busy || !status.running;
    $('cheer-order-field').hidden = config.mode !== 'pattern';
    $('cheer-text-label').textContent = config.mode === 'pattern' ? '패턴 (한 줄에 하나씩)' : '응원 문구';
    $('cheer-text').placeholder = config.mode === 'pattern' ? '/야광봉/\n응원합니다!' : '응원 문구 또는 /야광봉/';
    $('cheer-preview').replaceChildren();
    preview($('cheer-preview'), config.mode === 'single' ? config.text : config.pattern[0] || '');
  };
  const paint = value => {
    status = value;
    $('chat-cheer-open').classList.toggle('active', Boolean(value.running));
    const count = `${Number(value.count || 0).toLocaleString('ko-KR')}회`;
    const remaining = value.remaining > 0
      ? ` | ${Math.floor(value.remaining / 60)}:${String(value.remaining % 60).padStart(2, '0')} 남음` : '';
    $('cheer-status').textContent = value.running ? `전송 중 ${count}${remaining}`
      : value.message || (!scope.account ? '로그인이 필요합니다.'
        : !value.allowed ? '방송 연결 후 시작할 수 있습니다.' : `정지됨 | ${count}`);
    $('cheer-status').classList.toggle('active', Boolean(value.running));
    controls();
  };
  const report = error => {
    $('cheer-error-message').textContent = error.message || '요청을 처리하지 못했습니다.';
    if (!$('chat-cheer-error').open) $('chat-cheer-error').showModal();
  };
  const fill = config => {
    $('cheer-mode').value = config.mode;
    $('cheer-text').value = config.mode === 'single' ? config.text : config.pattern.join('\n');
    for (const field of fields.filter(field => !['mode', 'text'].includes(field))) {
      $('cheer-' + field).value = config[field];
    }
  };
  const poll = async current => {
    if (!dialog.open || current !== version) return;
    try {
      const data = await request('/api/cheer');
      if (current === version && key(data) === key(scope)) paint(data);
    } catch (error) {
      if (current === version) $('cheer-status').textContent = error.message;
    } finally {
      if (dialog.open && current === version) timer = setTimeout(() => void poll(current), 1500);
    }
  };
  const open = async (restored = false) => {
    if (dialog.open && !restored) { dialog.close(); return; }
    if (!restored) {
      $('chat-menu').close();
      show(dialog);
    }
    const current = ++version;
    loaded = false;
    controls();
    try {
      const data = await request('/api/cheer');
      if (!dialog.open || current !== version || key(data) !== key(scope)) return;
      revision = data.revision;
      fill(data.config);
      loaded = true;
      paint(data);
      timer = setTimeout(() => void poll(current), 1500);
    } catch (error) {
      if (current === version) report(error);
    }
  };
  const action = async name => {
    if (busy) return;
    const current = version;
    busy = true;
    controls();
    try {
      const data = await request('/api/cheer', { ...scope, action: name, config: read(), revision });
      if (current !== version || key(data) !== key(scope)) return;
      revision = data.revision;
      paint(data);
    } catch (error) {
      if (current === version) report(error);
    } finally {
      busy = false;
      if (current === version) controls();
    }
  };
  $('chat-cheer-open').addEventListener('click', () => void open());
  $('cheer-form').addEventListener('submit', event => { event.preventDefault(); void action('save'); });
  $('cheer-start').addEventListener('click', () => void action('start'));
  $('cheer-stop').addEventListener('click', () => void action('stop'));
  $('cheer-import').addEventListener('click', () => { $('cheer-text').value = compose(); controls(); });
  for (const field of fields) $('cheer-' + field).addEventListener('input', controls);
  $('cheer-error-close').addEventListener('click', () => $('chat-cheer-error').close());
  dialog.addEventListener('close', () => { version++; clearTimeout(timer); });
  dialog.addEventListener('popuprestore', () => void open(true));
  window.addEventListener('pagehide', () => { version++; clearTimeout(timer); });
  return {
    update(data) {
      const next = { player: data.cheer?.player || data.player || '', account: data.cheer?.account || '' };
      if (key(next) !== key(scope)) {
        scope = next;
        version++;
        loaded = false;
        clearTimeout(timer);
        dialog.close();
        $('chat-cheer-error').close();
        $('cheer-text').value = '';
      }
      $('cheer-scope').textContent = [data.name || next.player, next.account].filter(Boolean).join(' / ');
      if (data.cheer) paint(data.cheer);
    }
  };
}
