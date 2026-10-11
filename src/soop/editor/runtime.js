import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { readStored } from './storage.js';

export function readRecovery(session) {
  const stored = () => {
    if (session && !session.restore) return null;
    const value = readStored(session ? session.port - session.range.start + 1 : 0);
    return value ? { ...value, stored: true, editor: session
      ? { ...value.editor, port: session.port, range: session.range } : value.editor } : null;
  };
  if (!process.send || process.env.SOOPWORKER !== '1') {
    return stored();
  }

  return new Promise(resolve => {
    const receive = message => {
      if (message?.type === 'restore') {
        process.off('message', receive);
        resolve(message.state || stored());
      }
    };
    process.on('message', receive);
  });
}

export function saveRecovery(state) {
  if (process.env.SOOPWORKER === '1' && process.connected) {
    process.send({ type: 'checkpoint', state }, () => {});
  }
}

export function stopRecovery() {
  if (process.env.SOOPWORKER === '1' && process.connected) {
    process.send({ type: 'stopping' }, () => {});
  }
}

export async function supervise(entry, args = [], options = {}) {
  let child, timer, state = null, stopping = false, failures = 0;
  const sessionIndex = args.indexOf('--session');
  const sessionFile = sessionIndex < 0 ? null : args[sessionIndex + 1];
  const session = sessionFile ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : null;
  const portable = path.join(process.env.LOCALAPPDATA || os.homedir(), 'SOOPChat', 'node', 'node.exe');
  const executable = options.executable || (process.platform === 'win32' && fs.existsSync(portable)
    ? portable : process.execPath);

  return new Promise(resolve => {
    const finish = code => {
      clearTimeout(timer);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      if (session) {
        try {
          const lease = JSON.parse(fs.readFileSync(session.lock, 'utf8'));
          if (lease.id === session.lease) fs.rmSync(session.lock, { force: true });
        } catch {}
        try { fs.rmSync(sessionFile, { force: true }); } catch {}
      }
      resolve(code);
    };
    const stop = signal => {
      stopping = true;
      clearTimeout(timer);
      if (child) child.kill(signal || 'SIGTERM');
      else finish(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    const start = () => {
      if (stopping) return finish(0);
      try {
        if (session) {
          const lease = JSON.parse(fs.readFileSync(session.lock, 'utf8'));
          if (lease.id !== session.lease) throw new Error('화면 실행 요청이 만료되었습니다.');
          fs.writeFileSync(session.lock, JSON.stringify({ ...lease, pid: process.pid }), { mode: 0o600 });
          fs.writeFileSync(sessionFile, JSON.stringify({ ...session, expires: Date.now() + 90000 }), { mode: 0o600 });
        }
        const started = Date.now();
        const worker = spawn(executable, ['--no-maglev', entry, ...args], {
          cwd: process.cwd(), windowsHide: true,
          env: { ...process.env, SOOPWORKER: '1' },
          stdio: ['inherit', 'inherit', 'inherit', 'ipc']
        });
        child = worker;
        worker.on('message', message => {
          if (message?.type === 'checkpoint') state = message.state;
          if (message?.type === 'stopping') stopping = true;
        });
        worker.once('spawn', () => worker.send({ type: 'restore', state }, () => {}));
        worker.once('error', error => {
          stopping = true;
          console.error('[복구] 실행 실패:', error.message);
          finish(1);
        });
        worker.once('exit', (code, signal) => {
          child = null;
          if (stopping || code === 0 || ['SIGINT', 'SIGTERM'].includes(signal)) {
            return finish(code || 0);
          }
          if (session) {
            try {
              const lease = JSON.parse(fs.readFileSync(session.lock, 'utf8'));
              if (lease.id !== session.lease) return finish(1);
              fs.writeFileSync(session.lock, JSON.stringify({ ...lease, pid: process.pid }), { mode: 0o600 });
            } catch {
              return finish(1);
            }
          }
          failures = Date.now() - started > 60000 ? 1 : failures + 1;
          const delay = options.delay ?? Math.min(30000, 3000 * failures);
          console.error(`[복구] 종료 코드: ${code ?? signal}. ${delay / 1000}초 후 다시 연결합니다.`);
          timer = setTimeout(start, delay);
        });
      } catch (error) {
        stopping = true;
        console.error('[복구] 실행 준비 실패:', error.message);
        finish(1);
      }
    };
    start();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!['index', 'multi'].includes(name)) throw new Error('실행 대상 오류');
  const entry = fileURLToPath(new URL(`../../${name}.js`, import.meta.url));
  process.exitCode = await supervise(entry, process.argv.slice(3));
}
