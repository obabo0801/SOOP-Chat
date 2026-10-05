import { config } from 'dotenv';
import readline from 'readline';
import { SoopManager } from '#soop/manager';
import * as tenants from '#soop/tenants';
import * as control from '#soop/control';
import * as log from '#utils/log';
import { parseEnv } from '#utils/env';
config({ quiet: true });

parseEnv(undefined, false);

const manager = new SoopManager();

let rl, server, stopTask;
let queue = Promise.resolve();
let stopping = false;

function shutdown() {
  if (stopTask) {
    return stopTask;
  }

  stopping = true;

  stopTask = manager
    .destroy()
    .then(async () => {
      await queue.catch(() => {});
      await log.flush();
    })
    .catch(() => {
      console.error('종료 실패');
      process.exitCode = 1;
    });

  rl?.close();
  process.stdin.pause();
  process.stdin.unref?.();

  control.closeControl(server);

  return stopTask;
}

async function status({ action }) {
  if (stopping || action !== 'status') {
    throw new Error('명령 오류');
  }

  return manager.status();
}

async function start() {
  try {
    if (process.argv.length > 3) {
      throw new Error('연결 개수 오류');
    }

    const definitions = tenants.loadTenants();
    const options = tenants.tenantOptions(definitions, process.argv[2]);

    server = await control.listenControl(shutdown, status);

    tenants.createTenants(process.argv[2]);

    for (const option of options) {
      manager.add(option.id, option);
    }

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('line', input => {
      if (stopping || input.trim() !== '/목록') {
        return;
      }

      log.table(
        Object.fromEntries(manager.status().map(({ id, ...data }) => [id, data]))
      );
    });

    rl.on('SIGINT', () => {
      void shutdown();
    });

    process.on('SIGINT', () => {
      void shutdown();
    });

    process.on('SIGTERM', () => {
      void shutdown();
    });

    rl.on('close', () => {
      void shutdown();
    });

    queue = manager.run('connect').then(results => {
      if (!stopping) {
        log.table(Object.fromEntries(results));
      }
    });
  } catch (error) {
    let message;

    if (error.code === 'EADDRINUSE') {
      message = '이미 실행 중';
    }
    else {
      if (error.constructor === Error) {
        message = error.message;
      }
      else {
        message = '실행 오류';
      }
    }

    log.error('[연결]', message);
    process.exitCode = 1;

    await shutdown();
  }
}

async function stop() {
  try {
    await control.stopMulti();
    log.info('[종료]', '전체 종료');
  } catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) {
      log.info('[종료]', '실행 중인 연결 없음');
    }
    else {
      log.error('[종료]', '종료 실패');
      process.exitCode = 1;
    }
  }
}

if (process.argv[2] === '--stop') {
  await stop();
}
else {
  await start();
}
