import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

for (const path of ['../.env', '.env']) {
  try {
    loadEnvFile(fileURLToPath(new URL(path, import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (!process.env.SERVER) throw new Error('SERVER 환경변수를 설정해주세요.');
const server = new URL(process.env.SERVER);
if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password ||
    server.pathname !== '/' || server.search || server.hash) {
  throw new Error('SERVER에는 서버의 접속 주소만 입력해주세요.');
}

export const config = {
  framework: null,
  buildCommand: null,
  installCommand: null,
  outputDirectory: '.',
  routes: [{
    src: '/(.*)',
    dest: `${server.origin}/$1`,
    headers: {
      'Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store'
    }
  }]
};
