#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function validateHarness(root = path.resolve(here, '..')) {
  const failures = [];
  const requireFile = async (relative) => {
    try {
      const info = await stat(path.join(root, relative));
      if (!info.isFile()) failures.push(`필수 경로가 파일이 아닙니다: ${relative}`);
    } catch {
      failures.push(`필수 파일이 없습니다: ${relative}`);
    }
  };

  const requiredFiles = [
    'AGENTS.md', 'README.md', 'config/harness-policy.json',
    'config/approvers.json',
    '.agents/skills/cit-figma-design/SKILL.md',
    '.agents/skills/cit-figma-design/references/write-gates.md',
    '.agents/skills/cit-design-audit/SKILL.md',
    '.codex/agents/cit-design-auditor.toml', '.codex/config.toml',
    'docs/claude-comparison.md',
    'work/WORK_ORDER.md', 'work/APPROVAL_TEMPLATE.json',
    'scripts/check-ssot.mjs', 'scripts/verify-approval.mjs', 'scripts/approval-signature.mjs',
    'scripts/setup-approver.mjs', 'scripts/sign-approval.mjs', 'scripts/fingerprint-file.mjs',
    'scripts/test-approval.mjs', 'scripts/test-validator.mjs', 'scripts/validate-harness.mjs',
  ];
  for (const file of requiredFiles) await requireFile(file);
  try {
    await stat(path.join(root, 'design-language.md'));
    failures.push('design SSOT를 Codex 하네스 루트에 복사하지 마세요');
  } catch { /* 살아있는 SSOT는 이 하네스 밖에 그대로 둔다 */ }

  let policy;
  try {
    policy = JSON.parse(await readFile(path.join(root, 'config/harness-policy.json'), 'utf8'));
  } catch (error) {
    failures.push(`정책 파일이 유효한 JSON이 아닙니다: ${error.message}`);
  }
  if (policy) {
    const f = policy.figma ?? {};
    if (policy.authority?.designSsot?.codexAccess !== 'read-only') failures.push('Codex에게 design SSOT는 읽기 전용이어야 합니다');
    if (policy.authority?.designSsot?.copyIntoHarness !== false) failures.push('design SSOT는 이 하네스에 복사되지 않아야 합니다');
    if (f.defaultWriteMode !== 'separate-staging-file-only') failures.push('Codex 쓰기는 별도 staging 파일을 대상으로 해야 합니다');
    if (f.codexOriginalFileAccess !== 'view-only') failures.push('Codex는 원본 Figma 파일에 보기 전용 권한만 가져야 합니다');
    if (f.codexMayWriteOriginals !== false) failures.push('Codex의 원본 Figma 파일 직접 쓰기는 비활성화돼야 합니다');
    if (f.originalChanges !== 'human-applies-reviewed-staging-output') failures.push('원본 Figma 변경은 검토된 staging 결과를 사람이 적용해야 합니다');
    if (f.approvalSource !== 'local-ed25519-signature') failures.push('staging 쓰기는 서명된 로컬 승인을 사용해야 합니다');
    if (f.approvalSignatureAlgorithm !== 'Ed25519') failures.push('승인 서명 알고리즘은 Ed25519여야 합니다');
    if (f.approvalKeysFile !== 'config/approvers.json') failures.push('승인자 공개 키는 config/approvers.json을 사용해야 합니다');
    try {
      const registry = JSON.parse(await readFile(path.join(root, f.approvalKeysFile), 'utf8'));
      if (registry.schemaVersion !== 1 || typeof registry.approvers !== 'object' || Array.isArray(registry.approvers)) failures.push('approvers.json의 스키마가 잘못됐습니다');
      for (const [id, entry] of Object.entries(registry.approvers ?? {})) {
        if (!id.trim() || entry?.enabled !== true || typeof entry.publicKey !== 'string' || !entry.publicKey.includes('BEGIN PUBLIC KEY')) failures.push(`Ed25519 공개 키 항목이 잘못됐습니다: ${id}`);
      }
    } catch (error) { failures.push(`approvers.json이 유효하지 않습니다: ${error.message}`); }
    if (f.writerRole !== 'main-agent-only') failures.push('Figma 작성자는 주 에이전트로만 제한돼야 합니다');
    if (!Number.isInteger(f.approvalMaxAgeHours) || f.approvalMaxAgeHours < 1) failures.push('Figma approvalMaxAgeHours는 1 이상의 정수여야 합니다');
    if (f.requiresPostWriteScreenshot !== true) failures.push('쓰기 후 스크린샷이 필수로 설정돼야 합니다');
    if (policy.agents?.parallelMutation !== false) failures.push('Figma 병렬 변경은 비활성화돼야 합니다');
    if (policy.secrets?.allowCredentialsInFiles !== false) failures.push('파일 안의 자격증명은 금지돼야 합니다');
  }

  const readme = await readFile(path.join(root, 'README.md'), 'utf8').catch(() => '');
  if (!readme.includes('CIT_DESIGN_SSOT') || !readme.includes('CIT_DESIGN_INVENTORY_ROOT')) {
    failures.push('README는 두 이식성 환경변수(SSOT 경로 재지정)를 모두 문서화해야 합니다');
  }

  const credential = /(?:figd_[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
  async function scan(dir, relative = '') {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.cache' || entry.name === 'out') continue;
      const abs = path.join(dir, entry.name);
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) await scan(abs, rel);
      else if (entry.isFile()) {
        const data = await readFile(abs).catch(() => null);
        if (data && !data.includes(0) && credential.test(data.toString('utf8'))) failures.push(`자격증명으로 보이는 값이 발견됐습니다: ${rel}`);
      }
    }
  }
  await scan(root);
  return { ok: failures.length === 0, failures };
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const root = process.env.CIT_HARNESS_ROOT ? path.resolve(process.env.CIT_HARNESS_ROOT) : path.resolve(here, '..');
  const result = await validateHarness(root);
  if (result.ok) process.stdout.write('PASS — 필수 파일, 안전 정책, 이식성 문서, 비밀값 패턴 검사를 모두 통과했습니다.\n');
  else {
    for (const failure of result.failures) process.stderr.write(`FAIL — ${failure}\n`);
    process.exitCode = 1;
  }
}
