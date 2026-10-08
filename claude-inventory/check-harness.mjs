#!/usr/bin/env node
/**
 * check-harness.mjs — 하네스 자가검증
 *
 * harness.json 이 "있다"고 선언한 것이 실제로 있는지 대조한다.
 *
 * 왜 이게 있는가:
 *   이전 하네스(ds-harness/CLAUDE.md)는 에이전트 4개·스킬 4개·SSOT 파일을 선언했는데
 *   실제로는 하나도 없었다. 아무도 눈치채지 못한 채 3개월이 지났다.
 *   선언과 실재를 대조하는 장치가 없었기 때문이다. 이 스크립트가 그 장치다.
 *
 * SessionStart 훅이 매 세션 시작 시 자동 실행한다.
 * 문제가 없으면 조용하고, 어긋나면 그 자리에서 말한다.
 *
 * 종료 코드
 *   0  이상 없음 (또는 경고만)
 *   1  선언과 실재가 어긋남
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();
const QUIET = process.argv.includes('--quiet');

const problems = [];
const notes = [];

function versionParts(value) {
  const match = String(value ?? '').match(/^v?(\d+(?:\.\d+)+)$/);
  return match ? match[1].split('.').map(Number) : null;
}

function compareVersions(a, b) {
  const aa = versionParts(a) ?? [];
  const bb = versionParts(b) ?? [];
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const delta = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

async function main() {
  const manifestPath = path.join(ROOT, 'harness.json');
  if (!existsSync(manifestPath)) {
    console.error(`[하네스] harness.json 이 없습니다 — ${ROOT}`);
    process.exit(1);
  }
  const m = JSON.parse(await readFile(manifestPath, 'utf8'));

  const pluginPath = path.join(ROOT, '.claude-plugin', 'plugin.json');
  if (!existsSync(pluginPath)) {
    problems.push('플러그인 매니페스트 없음: .claude-plugin/plugin.json');
  } else {
    const plugin = JSON.parse(await readFile(pluginPath, 'utf8'));
    if (plugin.version !== m.version) {
      problems.push(`플러그인 버전(${plugin.version})과 harness.json 버전(${m.version})이 다릅니다`);
    }
  }
  const packagePath = path.join(ROOT, 'package.json');
  if (!existsSync(packagePath)) {
    problems.push('패키지 매니페스트 없음: package.json');
  } else {
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    if (pkg.version !== m.version) problems.push(`package.json 버전(${pkg.version})과 harness.json 버전(${m.version})이 다릅니다`);
  }

  // 1. 선언된 파일이 실제로 있는가
  for (const f of m.requires?.files ?? []) {
    if (!existsSync(path.join(ROOT, f))) problems.push(`파일 없음: ${f}`);
  }

  // 2. 선언된 스킬이 실제로 있는가
  const skillsDir = path.join(ROOT, 'skills');
  let actualSkills = [];
  if (existsSync(skillsDir)) {
    for (const e of await readdir(skillsDir, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(path.join(skillsDir, e.name, 'SKILL.md'))) {
        actualSkills.push(e.name);
      }
    }
  }
  for (const s of m.requires?.skills ?? []) {
    if (!actualSkills.includes(s)) problems.push(`스킬 없음: skills/${s}/SKILL.md`);
  }
  for (const s of actualSkills) {
    if (!(m.requires?.skills ?? []).includes(s)) {
      notes.push(`매니페스트에 없는 스킬: ${s} — harness.json 에 추가하세요`);
    }
  }

  // 3. 훅이 선언된 이벤트를 실제로 걸고 있는가
  const hooksPath = path.join(ROOT, 'hooks', 'hooks.json');
  if (existsSync(hooksPath)) {
    const h = JSON.parse(await readFile(hooksPath, 'utf8'));
    for (const ev of m.requires?.hooks ?? []) {
      if (!h.hooks?.[ev]) problems.push(`훅 없음: ${ev}`);
    }
  } else if ((m.requires?.hooks ?? []).length) {
    problems.push('hooks/hooks.json 이 없습니다');
  }

  // 4. SSOT 와 기계 판정본(spec.json)이 같은 버전을 가리키는가
  const specPath = path.join(ROOT, m.requires?.files?.find((f) => f.endsWith('spec.json')) ?? 'spec.json');
  const ssotPath = path.join(ROOT, m.ssot ?? 'design-language.md');
  if (existsSync(specPath) && existsSync(ssotPath)) {
    const spec = JSON.parse(await readFile(specPath, 'utf8'));
    const ssot = await readFile(ssotPath, 'utf8');
    // 표 행의 위치와 무관하게 가장 높은 의미 버전을 사용한다.
    const history = ssot.split('## 변경 이력')[1] ?? '';
    const vers = [...history.matchAll(/^\|\s*\**(v[\d.]+)\**\s*\|/gm)].map((x) => x[1]);
    const latest = vers.sort(compareVersions).at(-1);
    const specVersion = spec.source?.match(/\bv(\d+(?:\.\d+)+)\b/)?.[1];
    if (!latest) problems.push('design-language.md 변경 이력에서 버전을 찾을 수 없습니다');
    if (!specVersion) problems.push('spec.json source에 SSOT 버전이 없습니다');
    else if (latest && compareVersions(`v${specVersion}`, latest) !== 0) {
      problems.push(`spec.json(${specVersion})과 design-language.md 최신 버전(${latest})이 다릅니다`);
    }
  }

  // 4-b. 쓰기 세션인가 — 검수는 이 상태에서 돌면 안 된다
  //
  // **exit 0 으로 내보내면 안 된다.** Claude Code 는 SessionStart 훅의 출력을
  // 실패했을 때만 화면에 띄운다. 정상 종료하면 이 경고가 조용히 묻힌다.
  // 하네스에서 가장 중요한 경고가 안 보이는 것이므로, 쓰기 세션이면 exit 1 로
  // 내보낸다. non-blocking 이라 세션은 그대로 진행된다 — 막는 게 아니라 알리는 것.
  const writeSession = process.env.FIGMA_WRITE === '1';

  // 4-c. 시험 스위치 — 실패 경로가 화면에 뜨는지 확인용
  //
  //   $env:HARNESS_SELFTEST_FAIL="1"   → 다음 세션에서 실패 경고가 뜬다
  //   $env:HARNESS_SELFTEST_FAIL=""    → 원상복귀
  //
  // 왜 이렇게 하는가: 자가검증이 "이상 없음"만 조용히 말하고 실패 때 안 보이면
  // 이 스크립트는 존재 이유가 없다. 그런데 그걸 확인하려고 harness.json 을
  // 일부러 망가뜨리는 건 원본 보존 원칙과 맞지 않는다. 파일은 그대로 두고
  // 환경변수 하나로 실패 경로만 시험한다.
  if (process.env.HARNESS_SELFTEST_FAIL === '1') {
    problems.push('시험 스위치가 켜져 있습니다 (HARNESS_SELFTEST_FAIL=1) — 실제 이상이 아닙니다');
  }

  // 5. 스캔 결과가 오래됐는가
  const reportPath = path.join(ROOT, 'out', 'inventory-report.md');
  if (existsSync(reportPath)) {
    const days = (Date.now() - (await stat(reportPath)).mtimeMs) / 86400000;
    if (days > 100) notes.push(`마지막 스캔이 ${Math.round(days)}일 전입니다 — 분기 재확인 시점입니다 (node figma-inventory.mjs --refetch)`);
  } else {
    notes.push('아직 스캔 결과가 없습니다 — node figma-inventory.mjs');
  }

  // 출력
  //
  // ※ Claude Code 는 실패한 SessionStart 훅의 **첫 줄만** 화면에 보여준다 (실측).
  //   그래서 첫 줄에 핵심을 전부 담는다. 상세는 그 아래에 둔다.
  const env = (k) => process.env[k] || '미지정';

  if (writeSession || problems.length) {
    const head = [];
    if (writeSession) {
      head.push(
        `⚠ Figma 쓰기 세션 — ${env('FIGMA_MODE')} · 파일 ${env('FIGMA_WRITE_FILE')} · 부모 ${env('FIGMA_WRITE_PARENT')} · 작업 ${env('FIGMA_WRITE_OPS')} · 검수는 별도 세션에서`
      );
    }
    if (problems.length) {
      head.push(`✗ 하네스 이상 ${problems.length}건 — ${problems[0]}`);
    }

    console.error(`[하네스] ${head.join('  ||  ')}`);

    if (writeSession) {
      console.error('');
      console.error('┌─ ⚠ 이 세션은 Figma 쓰기 세션입니다 ──────────────────');
      console.error(`│  모드   ${env('FIGMA_MODE')}`);
      console.error(`│  파일   ${env('FIGMA_WRITE_FILE')}`);
      console.error(`│  부모   ${env('FIGMA_WRITE_PARENT')}`);
      console.error(`│  노드   ${env('FIGMA_WRITE_NODE')}`);
      console.error(`│  작업   ${env('FIGMA_WRITE_OPS')}`);
      console.error('│');
      console.error('│  검수(preflight)는 이 변수들을 끈 별도 세션에서 돌리세요.');
      console.error('│  안 그러면 자기 작업을 자기가 채점하게 됩니다.');
      console.error('│  끝나면: Remove-Item Env:FIGMA_MODE, Env:FIGMA_WRITE, …');
      console.error('└──────────────────────────────────────────────────────');
    }

    if (problems.length) {
      console.error('');
      console.error('┌─ [하네스] 선언과 실재가 어긋납니다 ───────────────────');
      for (const p of problems) console.error(`│  ✗ ${p}`);
      console.error('│');
      if (process.env.HARNESS_SELFTEST_FAIL === '1') {
        console.error('│  ※ 이것은 시험입니다. 자가검증이 제대로 말하고 있는 것입니다.');
        console.error('│     Remove-Item Env:HARNESS_SELFTEST_FAIL 로 끄세요.');
      } else {
        console.error('│  harness.json 을 고치거나 빠진 것을 만드세요.');
      }
      console.error('└──────────────────────────────────────────────────────');
    }

    // 쓰기 세션은 '고장'이 아니지만, exit 1 이어야 화면에 보인다.
    process.exit(1);
  }

  if (notes.length && !QUIET) {
    console.error('');
    console.error(`[하네스] ${m.name} v${m.version} · 스킬 ${actualSkills.length}개 · SSOT ${m.ssot}`);
    for (const n of notes) console.error(`  · ${n}`);
  } else if (!QUIET) {
    console.error(`[하네스] ${m.name} v${m.version} · 스킬 ${actualSkills.length}개 · 이상 없음`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`[하네스] 자가검증 실패: ${e.message}`);
  process.exit(1);
});
