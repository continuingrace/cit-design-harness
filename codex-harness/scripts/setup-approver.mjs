#!/usr/bin/env node
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`잘못된 인자입니다: ${key}`);
    const name = key.slice(2);
    if (Object.hasOwn(args, name)) throw new Error(`중복된 인자입니다: ${key}`);
    args[name] = argv[++i];
  }
  if (!args.approver || !args.key) throw new Error('필수 인자입니다: --approver, --key');
  if (!/^[A-Za-z0-9._@-]{2,100}$/.test(args.approver)) throw new Error('승인자 ID에 지원하지 않는 문자가 포함돼 있습니다');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keyPath = path.resolve(args.key);
  const relativeKeyPath = path.relative(root, keyPath);
  if (relativeKeyPath === '' || (!relativeKeyPath.startsWith(`..${path.sep}`) && relativeKeyPath !== '..' && !path.isAbsolute(relativeKeyPath))) {
    throw new Error('개인 키는 저장소 밖에 저장해야 합니다');
  }
  const registryPath = path.join(root, 'config/approvers.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  if (registry.approvers?.[args.approver]) throw new Error(`이미 등록된 승인자입니다: ${args.approver}`);
  await mkdir(path.dirname(keyPath), { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await writeFile(keyPath, privateKey, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    if (process.platform === 'win32') {
      await execFile('icacls.exe', [keyPath, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(F)`], { windowsHide: true });
    } else {
      await chmod(keyPath, 0o600);
    }
    createPublicKey(publicKey);
    registry.approvers ??= {};
    registry.approvers[args.approver] = { enabled: true, publicKey };
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  } catch (error) {
    await rm(keyPath, { force: true });
    throw new Error(`승인자 키를 안전하게 등록하지 못해 개인 키를 삭제했습니다: ${error.message}`);
  }
  process.stdout.write(`PASS — ${args.approver}용 Ed25519 키를 만들었습니다. 개인 키는 저장소 밖에 있고, 공개 키는 ${path.relative(root, registryPath)}에 추가됐습니다.\n`);
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  try { await main(); }
  catch (error) { process.stderr.write(`FAIL — ${error.message}\n`); process.exitCode = 1; }
}
