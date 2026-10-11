export function createBroadcast(request, refresh) {
  const $ = id => document.getElementById(id);
  const dialog = $('broadcast-access');
  let player = '';
  let shown = '';
  let busy = false;

  $('broadcast-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { $('broadcast-password').value = ''; });
  $('broadcast-form').addEventListener('submit', async event => {
    event.preventDefault();

    if (busy) {
      return;
    }

    busy = true;
    $('broadcast-submit').disabled = true;
    $('broadcast-close').disabled = true;

    try {
      await request('POST', { player, password: $('broadcast-password').value }, '/api/broadcast');
      dialog.close();
      await refresh();
    } catch (error) {
      $('connect-message').textContent = error.message;
      if (!$('connect-error').open) {
        $('connect-error').showModal();
      }
    } finally {
      busy = false;
      $('broadcast-submit').disabled = false;
      $('broadcast-close').disabled = false;
    }
  });

  return {
    update(data) {
      if (player !== data.player) {
        player = data.player || '';
        shown = '';
        if (dialog.open) {
          dialog.close();
        }
      }

      if (busy) {
        return;
      }

      if (!data.restricted?.passwordRequired) {
        shown = '';
        if (dialog.open) {
          dialog.close();
        }
        return;
      }

      const key = `${player}:${data.broadcast?.number || ''}`;

      if (shown !== key) {
        shown = key;
        dialog.showModal();
        $('broadcast-password').focus();
      }
    }
  };
}
