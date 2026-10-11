export function createQuick(request, refresh, report) {
  const $ = id => document.getElementById(id);
  const dialog = $('quick');
  const buttons = new Map([
    ['!멤버', ['video-members-edit', '멤버 수정']],
    ['!일정', ['video-schedule-edit', '일정 수정']]
  ]);
  let player = '', available = [], current, version = 0;
  const close = () => {
    version++;
    current = null;
    dialog.close();
  };

  for (const [command, [id, title]] of buttons) {
    $(id).addEventListener('click', async () => {
      if (!available.includes(command)) {
        return;
      }

      const revision = ++version;
      const channel = player;
      $(id).disabled = true;

      try {
        const params = new URLSearchParams({ player: channel, command });
        const data = await request('GET', undefined, `/api/macro?${params}`);

        if (revision !== version || channel !== player) {
          return;
        }

        current = data;
        $('quick-title').textContent = title;
        $('quick-reply').value = data.reply;
        $('quick-status').hidden = true;
        dialog.showModal();
        $('quick-reply').focus();
      }
      catch (error) {
        if (revision === version) {
          report(error);
        }
      }
      finally {
        $(id).disabled = false;
      }
    });
  }

  $('quick-close').addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  $('quick-form').addEventListener('submit', async event => {
    event.preventDefault();
    const session = current;

    if (!session || $('quick-save').disabled) {
      return;
    }

    $('quick-save').disabled = true;
    $('quick-status').hidden = true;

    try {
      await request('PUT', { ...session, reply: $('quick-reply').value }, '/api/macro');

      if (current !== session) {
        return;
      }

      close();
      await refresh();
    }
    catch (error) {
      if (current === session) {
        $('quick-status').textContent = error.message;
        $('quick-status').hidden = false;
      }
    }
    finally {
      $('quick-save').disabled = false;
    }
  });

  return {
    close,
    update(data) {
      const commands = data.shortcuts || [];

      if (player !== data.player || current && !commands.includes(current.command)) {
        close();
      }

      player = data.player;
      available = commands;

      for (const [command, [id]] of buttons) {
        $(id).hidden = !commands.includes(command);
      }
    }
  };
}
