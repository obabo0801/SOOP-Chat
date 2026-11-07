import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as child from 'child_process';

export function createCredentials(directory = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), '.config'), 'SOOPChat', 'accounts'
)) {
  const file = id => {
    if (!/^[a-zA-Z0-9_]{1,50}$/.test(id || '')) throw new Error('계정 아이디 오류');
    return path.join(directory, crypto.createHash('sha256').update(id.toLowerCase()).digest('hex') + '.json');
  };
  const key = () => {
    const target = path.join(directory, 'key');
    try { fs.writeFileSync(target, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return fs.readFileSync(target);
  };
  const protect = (value, decode = false) => {
    const method = decode ? 'Unprotect' : 'Protect';
    const script = `Add-Type -AssemblyName System.Security; $value=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${method}($value,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
    return Buffer.from(child.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: value.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim(), 'base64');
  };
  return {
    has(id) { return Boolean(id && fs.existsSync(file(id))); },
    save(id, value) {
      const target = file(id);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const data = Buffer.from(JSON.stringify(value));
      let encrypted;
      if (process.platform === 'win32') encrypted = 'dpapi:' + protect(data).toString('base64');
      else {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
        const content = Buffer.concat([cipher.update(data), cipher.final()]);
        encrypted = 'aes:' + Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
      }
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
      fs.renameSync(temporary, target);
    },
    load(id) {
      try {
        const value = fs.readFileSync(file(id), 'utf8');
        const data = Buffer.from(value.slice(value.indexOf(':') + 1), 'base64');
        let decoded;
        if (value.startsWith('dpapi:') && process.platform === 'win32') decoded = protect(data, true);
        else if (value.startsWith('aes:') && process.platform !== 'win32') {
          const decipher = crypto.createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
          decipher.setAuthTag(data.subarray(12, 28));
          decoded = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
        } else throw new Error('계정 저장 형식 오류');
        return JSON.parse(decoded.toString('utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error('저장된 로그인 정보를 확인하지 못했습니다. 다시 로그인해주세요.');
      }
    },
    remove(id) { fs.rmSync(file(id), { force: true }); }
  };
}

export const accounts = createCredentials();
