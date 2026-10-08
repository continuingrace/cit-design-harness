#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const policy = JSON.parse(await readFile(path.join(root, 'config', 'harness-policy.json'), 'utf8'));
// 환경변수가 없으면 기본 경로는 하네스 루트(codex-harness/) 기준 상대경로다.
// 실행 위치(저장소 루트, codex-harness/ 등)에 따라 결과가 갈리지 않도록 cwd가 아니라 root로 고정한다.
const ssotPath = process.env[policy.authority.designSsot.pathEnv] || path.resolve(root, policy.authority.designSsot.path);

try {
  const content = await readFile(ssotPath);
  const info = await stat(ssotPath);
  const sha256 = createHash('sha256').update(content).digest('hex');

  process.stdout.write(JSON.stringify({
    path: ssotPath,
    bytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    sha256,
  }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`FAIL — SSOT 파일을 읽을 수 없습니다: ${ssotPath}\n원인: ${error.message}\n`);
  process.exitCode = 1;
}
