import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

export function readSession() {
  const index = process.argv.indexOf('--session');

  if (index < 0) {
    return null;
  }

  const file = process.argv[index + 1];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  fs.unlinkSync(file);
  const lease = JSON.parse(fs.readFileSync(data.lock, 'utf8'));

  if (lease.id !== data.lease || Date.now() > data.expires) {
    throw new Error('화면 실행 요청이 만료되었습니다.');
  }

  fs.writeFileSync(data.lock, JSON.stringify({ pid: process.pid, id: data.lease,
    workspace: process.cwd() }), { mode: 0o600 });

  return data;
}

export function portRange(value) {
  const { start, count } = value || {};

  if (!Number.isInteger(start) || !Number.isInteger(count) || count < 1
    || count > 100 || start < 1 || start + count - 1 > 65535) {
    throw new Error('화면 개수 설정 오류');
  }

  return { start, count };
}

export async function listenEditor(server, { port = 0, count = 10, host, range }) {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('화면 개수 설정 오류');
  }

  const listen = (socket, next) => new Promise((resolve, reject) => {
    const fail = error => {
      socket.off('listening', ready);
      reject(error);
    };
    const ready = () => {
      socket.off('error', fail);
      resolve();
    };

    socket.once('error', fail);
    socket.once('listening', ready);
    socket.listen({ port: next, host, exclusive: true });
  });
  const close = socket => new Promise(resolve => socket.close(resolve));

  if (range) {
    const selected = portRange(range);

    if (port < selected.start || port >= selected.start + selected.count) {
      throw new Error('포트가 화면 설정 범위를 벗어났습니다.');
    }

    await listen(server, port);
    return selected;
  }

  let next = port;

  while (next === 0 || next + count - 1 <= 65535) {
    const probes = [];

    try {
      await listen(server, next);
      next = server.address().port;
      portRange({ start: next, count });

      for (let offset = 1; offset < count; offset++) {
        const probe = net.createServer();

        await listen(probe, next + offset);
        probes.push(probe);
      }

      return { start: next, count };
    } catch (error) {
      if (server.listening) {
        await close(server);
      }

      if (error.code !== 'EADDRINUSE') {
        throw error;
      }
      next += count;
    } finally {
      await Promise.all(probes.map(close));
    }
  }

  throw new Error('사용 가능한 포트 범위가 없습니다.');
}

export async function launchSession(options, current, range, host, preferred) {
  const { start, count } = portRange(range);
  const lease = crypto.randomBytes(16).toString('hex');
  let port;
  let lock;

  for (let next = start; next < start + count; next++) {
    if (preferred !== undefined && next !== preferred) continue;
    if (next === current) {
      continue;
    }

    const file = path.join(os.tmpdir(), `soopeditor${next}.lock`);

    try {
      const lease = JSON.parse(fs.readFileSync(file, 'utf8'));

      try {
        process.kill(lease.pid, 0);
        continue;
      } catch (error) {
        if (error.code !== 'ESRCH') {
          continue;
        }
      }

      fs.unlinkSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        continue;
      }
    }

    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, id: lease,
        workspace: process.cwd() }), { flag: 'wx', mode: 0o600 });
    } catch {
      continue;
    }

    const available = await new Promise(resolve => {
      const server = net.createServer(socket => socket.destroy());

      server.once('error', () => resolve(false));
      server.listen({ port: next, host, exclusive: true }, () => server.close(() => resolve(true)));
    });

    if (available) {
      port = next;
      lock = file;
      break;
    }

    fs.unlinkSync(file);
  }

  if (!port) {
    throw new Error(`최대 ${count}개까지 열 수 있습니다. 사용 중인 화면을 종료해주세요.`);
  }

  const token = options.restore && /^[a-f0-9]{64}$/.test(options.token || '')
    ? options.token : crypto.randomBytes(32).toString('hex');
  const file = path.join(os.tmpdir(), `soopeditor${crypto.randomBytes(16).toString('hex')}.json`);
  const entry = fileURLToPath(new URL('./runtime.js', import.meta.url));
  const hostname = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const origin = `http://${net.isIP(hostname) === 6 ? `[${hostname}]` : hostname}:${port}`;
  const data = { ...options, host, port, count, range, token, lock, lease,
    expires: Date.now() + 90000, browser: false, sessionReady: true };

  try {
    fs.writeFileSync(file, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    const args = ['--no-maglev', entry, 'index', '--session', file];
    let child;

    if (process.platform === 'win32') {
      const quote = value => `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
      const terminal = fileURLToPath(new URL('./terminal.ps1', import.meta.url));
      const request = Buffer.from(JSON.stringify({ arguments: [
        '-w', '0', 'new-tab', '--title', options.bjId || 'SOOP', '--suppressApplicationTitle',
        '-d', process.cwd(), process.execPath, ...args
      ].map(quote).join(' ') })).toString('base64');
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', terminal, '-Request', request], {
        cwd: process.cwd(), windowsHide: true, stdio: 'ignore'
      });
    }
    else if (process.env.TMUX) {
      child = spawn('tmux', ['new-window', '-n', options.bjId || 'SOOP', process.execPath, ...args]);
    }
    else {
      throw new Error('새 화면은 Windows Terminal 또는 tmux에서 실행해주세요.');
    }

    let failure;

    child.once('error', error => { failure = error; });
    child.once('exit', code => {
      if (code) {
        failure = new Error('터미널 탭을 열지 못했습니다.');
      }
    });

    for (let attempt = 0; attempt < 80; attempt++) {
      if (failure) {
        throw new Error('터미널 탭을 열지 못했습니다.');
      }

      try {
        const response = await fetch(`${origin}/api/entry`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(500)
        });

        if (response.ok) {
          return { port, number: port - start + 1, token };
        }
      } catch {}

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error('새 화면을 열지 못했습니다. 서버 터미널을 확인해주세요.');
  } catch (error) {
    fs.rmSync(file, { force: true });
    try {
      const currentLease = JSON.parse(fs.readFileSync(lock, 'utf8'));

      if (currentLease.id === lease) {
        if (currentLease.pid !== process.pid) {
          process.kill(currentLease.pid);
        }
        fs.rmSync(lock, { force: true });
      }
    } catch {}
    throw error;
  }
}
