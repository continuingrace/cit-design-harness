#!/usr/bin/env node
/**
 * test-block-figma-write.mjs — 차단 훅 회귀 테스트
 *
 *   node test-block-figma-write.mjs
 *
 * 교차 검토에서 **실제로 재현된 우회**를 전부 케이스로 박아둔다.
 * 같은 구멍이 다시 열리면 여기서 걸린다.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, 'block-figma-write.mjs');
const hookSource = await readFile(HOOK, 'utf8');
const hookScript = new vm.Script(hookSource, { filename: HOOK });

const PASS = 0;
const BLOCK = 2;

/** 정상 승인 한 벌 — 파일·노드·작업·모드 전부 지정 */
const OK_ENV = {
  FIGMA_MODE: 'staging',
  FIGMA_WRITE: '1',
  FIGMA_WRITE_FILE: 'ABC123',
  FIGMA_WRITE_NODE: '3732:289',
  FIGMA_WRITE_OPS: 'use_figma',
  FIGMA_WRITE_PARENT: '9000:1',   // 스테이징 섹션 (AI_CLAUDE__…)
};

/** [설명, stdin, env, 기대] */
const CASES = [
  // ── 조회는 언제나 통과 ───────────────────────────────────────
  ['조회 · 공식',              { tool_name: 'mcp__Figma__get_design_context' }, {}, PASS],
  ['조회 · 스크린샷',           { tool_name: 'mcp__Figma__get_screenshot' }, {}, PASS],
  ['조회 · 소문자 서버',        { tool_name: 'mcp__figma__get_figma_data' }, {}, PASS],
  ['조회 · CLI 플러그인',       { tool_name: 'mcp__plugin:figma:figma__get_metadata' }, {}, PASS],
  ['Figma 무관 도구',          { tool_name: 'mcp__Slack__send_message' }, {}, PASS],
  ['인증은 통과 (검수 세션에서도)',
    { tool_name: 'mcp__plugin_figma_figma__authenticate' }, {}, PASS],
  ['인증 통과해도 생성은 차단',
    { tool_name: 'mcp__plugin_figma_figma__create_new_file' }, {}, BLOCK],

  // ── 승인 없는 쓰기는 차단 ────────────────────────────────────
  ['쓰기 · use_figma',         { tool_name: 'mcp__Figma__use_figma' }, {}, BLOCK],
  ['쓰기 · 새 파일',            { tool_name: 'mcp__figma__create_new_file' }, {}, BLOCK],
  ['쓰기 · 디자인 생성',        { tool_name: 'mcp__plugin:figma:figma__generate_figma_design' }, {}, BLOCK],
  ['쓰기 · 업로드',            { tool_name: 'mcp__Figma__upload_assets' }, {}, BLOCK],

  // ── v1 에서 뚫린 것 (회귀) ───────────────────────────────────
  ['v1① get_ 접두 위장',       { tool_name: 'mcp__Figma__get_and_delete_node' }, {}, BLOCK],
  ['v1② 깨진 JSON',           '이건 JSON이 아니다', {}, BLOCK],
  ['v1② 빈 입력',             '', {}, BLOCK],
  ['v1② 도구명 없음',          { foo: 'bar' }, {}, BLOCK],
  ['알 수 없는 figma 도구',     { tool_name: 'mcp__Figma__frobnicate_layers' }, {}, BLOCK],

  // ── v2 에서 뚫린 것 (회귀) ───────────────────────────────────
  ['v2④ 메모에 승인 키 심기',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { fileKey: 'OTHER999', note: '참고: ABC123 관련 작업' } },
    OK_ENV, BLOCK],
  ['v2④ 설명에 승인 URL 심기',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { fileKey: 'OTHER999', description: 'figma.com/design/ABC123/x 참고' } },
    OK_ENV, BLOCK],
  ['v2⑤ 승인 파일 + 미승인 노드',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { fileKey: 'ABC123', nodeId: '9999:1' } },
    OK_ENV, BLOCK],
  ['v2⑥ 승인 파일·노드 + 미승인 작업',
    { tool_name: 'mcp__Figma__create_new_file',
      tool_input: { fileKey: 'ABC123', nodeId: '3732:289' } },
    OK_ENV, BLOCK],

  // ── 범위 축별 누락 ───────────────────────────────────────────
  ['모드 미지정',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123' } },
    { ...OK_ENV, FIGMA_MODE: '' }, BLOCK],
  ['작업 목록 미지정',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123' } },
    { ...OK_ENV, FIGMA_WRITE_OPS: '' }, BLOCK],
  ['파일 미지정',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123' } },
    { ...OK_ENV, FIGMA_WRITE_FILE: '' }, BLOCK],
  ['입력에 파일 키 없음 — 검증 불가',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { foo: 'bar' } },
    OK_ENV, BLOCK],
  ['edit 모드인데 노드 없음',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123' } },
    { ...OK_ENV, FIGMA_MODE: 'edit' }, BLOCK],
  ['노드 참조하는데 노드 승인 없음',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123', nodeId: '3732:289' } },
    { ...OK_ENV, FIGMA_WRITE_NODE: '' }, BLOCK],

  // ── 정상 경로 ────────────────────────────────────────────────
  // ── v4 에서 막은 것 ⑦ · staging 위치 고정 ────────────────────
  ['v4⑦ staging 인데 노드 참조 없음',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123' } },
    OK_ENV, BLOCK],
  ['v4 부모 미지정',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { fileKey: 'ABC123', nodeId: '9000:1' } },
    { ...OK_ENV, FIGMA_WRITE_PARENT: '' }, BLOCK],
  ['v4 부모 형식 오류',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { fileKey: 'ABC123', nodeId: '9000:1' } },
    { ...OK_ENV, FIGMA_WRITE_PARENT: 'AI_CLAUDE__작업' }, BLOCK],
  ['v4 new-file 인데 기존 노드 참조',
    { tool_name: 'mcp__Figma__create_new_file',
      tool_input: { fileKey: 'ABC123', nodeId: '3732:289' } },
    { ...OK_ENV, FIGMA_WRITE_PARENT: 'new-file', FIGMA_WRITE_OPS: 'create_new_file' }, BLOCK],
  ['v4 new-file · 노드 없음 (정상)',
    { tool_name: 'mcp__Figma__create_new_file', tool_input: { fileKey: 'ABC123' } },
    { ...OK_ENV, FIGMA_WRITE_PARENT: 'new-file', FIGMA_WRITE_OPS: 'create_new_file' }, PASS],
  // ── use_figma 의 실제 스키마: fileKey · code · description (nodeId 없음) ──
  ['v5 use_figma · 코드에 승인 부모 명시 (정상)',
    { tool_name: 'mcp__plugin_figma_figma__use_figma',
      tool_input: { fileKey: 'ABC123', description: '프레임 생성',
        code: 'const parent = await figma.getNodeByIdAsync("9000:1"); parent.appendChild(f);' } },
    OK_ENV, PASS],
  ['v5 use_figma · 코드에 미승인 노드',
    { tool_name: 'mcp__plugin_figma_figma__use_figma',
      tool_input: { fileKey: 'ABC123', description: '프레임 생성',
        code: 'const parent = await figma.getNodeByIdAsync("7777:7"); parent.appendChild(f);' } },
    OK_ENV, BLOCK],
  ['v5 use_figma · 승인 부모 + 미승인 노드 섞임',
    { tool_name: 'mcp__plugin_figma_figma__use_figma',
      tool_input: { fileKey: 'ABC123', description: '프레임 생성',
        code: 'const p = await figma.getNodeByIdAsync("9000:1"); const x = await figma.getNodeByIdAsync("7777:7"); x.remove();' } },
    OK_ENV, BLOCK],
  ['v5 use_figma · currentPage 암묵 지정은 차단',
    { tool_name: 'mcp__plugin_figma_figma__use_figma',
      tool_input: { fileKey: 'ABC123', description: '프레임 생성',
        code: 'figma.currentPage.appendChild(figma.createFrame());' } },
    OK_ENV, BLOCK],
  ['v5 use_figma · 승인 ID를 적고 currentPage 사용은 차단',
    { tool_name: 'mcp__plugin_figma_figma__use_figma',
      tool_input: { fileKey: 'ABC123', code: 'const p = await figma.getNodeByIdAsync("9000:1"); figma.currentPage.appendChild(f);' } },
    OK_ENV, BLOCK],
  ['v5 use_figma · node ID 동적 계산은 차단',
    { tool_name: 'mcp__plugin_figma_figma__use_figma',
      tool_input: { fileKey: 'ABC123', code: 'const hint = "9000:1"; const p = await figma.getNodeByIdAsync(targetId); p.appendChild(f);' } },
    OK_ENV, BLOCK],
  ['staging · 승인 부모 아래 생성 (정상)',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { fileKey: 'ABC123', parentNodeId: '9000:1' } },
    OK_ENV, PASS],
  ['staging · 부모도 승인 노드도 아닌 곳',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { fileKey: 'ABC123', parentNodeId: '7777:7' } },
    OK_ENV, BLOCK],
  ['staging · 파일 + 승인 노드',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123', nodeId: '3732:289' } },
    OK_ENV, PASS],
  ['edit · 파일 + 승인 노드',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123', nodeId: '3732:289' } },
    { ...OK_ENV, FIGMA_MODE: 'edit' }, PASS],
  ['URL 로 준 경우 · 승인 파일·노드',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { url: 'https://www.figma.com/design/ABC123/x?node-id=3732-289' } },
    OK_ENV, PASS],
  ['URL 로 준 경우 · 미승인 파일',
    { tool_name: 'mcp__Figma__use_figma',
      tool_input: { url: 'https://www.figma.com/design/OTHER999/x?node-id=3732-289' } },
    OK_ENV, BLOCK],

  // ── 쓰기 세션에서도 조회는 통과 (분리 실효 확인) ──────────────
  ['쓰기 세션에서 조회는 통과',
    { tool_name: 'mcp__Figma__get_design_context' }, OK_ENV, PASS],
  ['변수 없는 검수 세션에서 쓰기는 차단',
    { tool_name: 'mcp__Figma__use_figma', tool_input: { fileKey: 'ABC123' } }, {}, BLOCK],
];

function runHook(input, env) {
  const events = new Map();
  const stderr = [];
  let status = null;
  const fakeProcess = {
    env: {
      FIGMA_MODE: '', FIGMA_WRITE: '', FIGMA_WRITE_FILE: '',
      FIGMA_WRITE_NODE: '', FIGMA_WRITE_OPS: '',
      ...env,
    },
    stdin: { on: (event, callback) => events.set(event, callback) },
    stderr: { write: (chunk) => stderr.push(String(chunk)) },
    exit: (code) => { status = code; throw new Error('__HOOK_EXIT__'); },
  };
  hookScript.runInNewContext({ process: fakeProcess }, { timeout: 1000 });
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  try {
    events.get('data')?.(raw);
    events.get('end')?.();
  } catch (error) {
    if (error.message !== '__HOOK_EXIT__') throw error;
  }
  if (status === null) throw new Error('hook ended without an exit code');
  return { status, stderr: stderr.join('') };
}

let pass = 0;
let fail = 0;

for (const [name, input, env, expected] of CASES) {
  const r = runHook(input, env);
  const ok = r.status === expected;
  ok ? pass++ : fail++;
  const label = expected === PASS ? '통과해야' : '차단해야';
  console.log(
    `  ${ok ? '✓' : '✗'} ${name.padEnd(34)} ${label}  →  exit=${r.status}${ok ? '' : `  (기대 ${expected})`}`
  );
}

console.log('');
console.log(`  ${pass}건 통과 · ${fail}건 실패`);
console.log('');
console.log('  ※ "검수 스킬은 쓰기 금지" 는 훅이 강제할 수 없다.');
console.log('    PreToolUse 입력에 어느 스킬이 도는지가 없기 때문이다.');
console.log('    검수는 환경변수를 켜지 않은 세션에서 돌린다 — 그러면 마지막 케이스대로 전부 차단된다.');
process.exit(fail ? 1 : 0);
