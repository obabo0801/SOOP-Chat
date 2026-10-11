export function createTheme(select) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const modes = ['system', 'light', 'dark'];
  let saved;

  try {
    saved = window.localStorage.getItem('editor-theme');
  } catch {}

  select.value = modes.includes(saved) ? saved : 'system';

  const update = () => {
    const dark = select.value === 'dark'
      || select.value === 'system' && media.matches
      || document.body.classList.contains('theater');

    document.body.classList.toggle('dark', dark);
    window.dispatchEvent(new Event('theme'));
  };

  select.addEventListener('change', () => {
    try {
      window.localStorage.setItem('editor-theme', select.value);
    } catch {}

    update();
  });
  media.addEventListener('change', update);
  window.addEventListener('storage', event => {
    if (event.key === 'editor-theme') {
      select.value = modes.includes(event.newValue) ? event.newValue : 'system';
      update();
    }
  });
  update();

  return { update };
}
