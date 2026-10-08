#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHarness } from '../codex-harness/scripts/validate-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));

const codex = await validateHarness(path.join(root, 'codex-harness'));
problems.push(...codex.failures.map((x) => `Codex: ${x}`));

const [harness, claudePackage, plugin, spec, design, codexPolicy, rootIgnore] = await Promise.all([
  readJson('claude-inventory/harness.json'),
  readJson('claude-inventory/package.json'),
  readJson('claude-inventory/.claude-plugin/plugin.json'),
  readJson('claude-inventory/spec.json'),
  readFile(path.join(root, 'claude-inventory/design-language.md'), 'utf8'),
  readJson('codex-harness/config/harness-policy.json'),
  readFile(path.join(root, '.gitignore'), 'utf8'),
]);

for (const [label, version] of [['harness.json', harness.version], ['package.json', claudePackage.version], ['plugin.json', plugin.version]]) {
  if (version !== harness.version) problems.push(`Claude 버전 불일치: ${label}=${version}, harness=${harness.version}`);
}
const history = design.split('## 변경 이력')[1] ?? '';
const versions = [...history.matchAll(/^\|\s*\**(v[\d.]+)\**\s*\|/gm)].map((match) => match[1]);
const versionTuple = (s) => s.slice(1).split('.').map(Number);
const latest = versions.sort((a, b) => {
  const x = versionTuple(a), y = versionTuple(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}).at(-1);
const specVersion = spec.source?.match(/\bv(\d+(?:\.\d+)+)\b/)?.[1];
if (!latest || `v${specVersion}` !== latest) problems.push(`SSOT/spec 버전 불일치: 최신=${latest ?? '없음'}, spec=${specVersion ?? '없음'}`);

const ssotPath = path.resolve(root, 'codex-harness', codexPolicy.authority.designSsot.path);
if (ssotPath !== path.join(root, 'claude-inventory/design-language.md')) problems.push('Codex 기본 SSOT 경로가 이 저장소의 Claude SSOT를 가리켜야 합니다');
for (const required of ['**/.cache/', '**/out/', '**/.env', '**/*.pem', '**/*.key', '**/*.secret']) {
  if (!rootIgnore.includes(required)) problems.push(`루트 .gitignore에 ${required} 항목이 없습니다`);
}

// 이 저장소 수준에서 "있다고 문서가 가정하는" 파일들. claude-inventory/harness.json의
// 선언-실재 대조와 같은 발상을 저장소 루트에도 적용한다.
const requiredRootFiles = [
  'README.md', 'REVIEW.md', '.editorconfig', '.gitattributes', '.gitignore',
  'docs/architecture.md', 'docs/getting-started.md', 'docs/approval-key-setup.md',
  'docs/github-approval-setup.md', 'docs/figma-access-smoke-test.md',
  '.github/PULL_REQUEST_TEMPLATE.md', '.github/CODEOWNERS', '.github/workflows/preflight.yml',
];
for (const relative of requiredRootFiles) {
  try {
    const info = await stat(path.join(root, relative));
    if (!info.isFile()) problems.push(`필수 경로가 파일이 아닙니다: ${relative}`);
  } catch {
    problems.push(`필수 파일이 없습니다: ${relative}`);
  }
}

const secretPatterns = [
  /figd_[A-Za-z0-9_-]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const skipDirs = new Set(['.git', 'node_modules', '.cache', 'out']);
const markdownFiles = [];
async function scan(dir, relative = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && skipDirs.has(entry.name)) continue;
    if (skipDirs.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) await scan(absolute, rel);
    else if (entry.isFile()) {
      const bytes = await readFile(absolute);
      if (bytes.includes(0)) continue;
      const content = bytes.toString('utf8');
      if (secretPatterns.some((pattern) => pattern.test(content))) problems.push(`자격증명으로 보이는 값이 발견됐습니다: ${rel}`);
      if (entry.name.endsWith('.md')) markdownFiles.push({ absolute, rel, content });
    }
  }
}
await scan(root);

// 마크다운 안의 상대경로 링크가 실제 파일을 가리키는지 확인한다. 외부 링크(http/https/mailto)와
// 문서 내부 앵커(#)는 대상 파일이 없으므로 검사하지 않는다.
for (const { absolute, rel, content } of markdownFiles) {
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    let target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    let resolved;
    try {
      resolved = path.resolve(path.dirname(absolute), decodeURI(target));
    } catch {
      problems.push(`마크다운 링크 경로를 해석할 수 없습니다: ${rel} -> ${match[1]}`);
      continue;
    }
    try {
      await stat(resolved);
    } catch {
      problems.push(`마크다운 링크가 끊어졌습니다: ${rel} -> ${match[1]}`);
    }
  }
}

if (problems.length) {
  for (const problem of problems) process.stderr.write(`FAIL — ${problem}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('PASS — Claude/Codex SSOT 버전과 경로, 필수 ignore 규칙, 저장소 필수 파일, 마크다운 링크, 비밀값 패턴을 확인했습니다.\n');
}
