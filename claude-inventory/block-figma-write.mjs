#!/usr/bin/env node
/**
 * block-figma-write.mjs — Figma 쓰기 차단 (PreToolUse 훅) · v6
 *
 * 교차 검토에서 실제로 재현된 우회들. 같은 구멍을 다시 열지 않기 위해 남긴다.
 *   v1 ① get_and_delete_node   → 'get' 접두사라고 통과
 *      ② 파싱 실패             → exit 0
 *      ③ FIGMA_WRITE=1        → 세션 전체 개방
 *   v2 ④ fileKey=OTHER999 인데 메모 필드에 승인 키 문자열 → 통과
 *         (JSON.stringify().includes() 로 전체 문자열을 뒤진 탓)
 *      ⑤ 승인 파일이면 **미승인 노드**도 통과 (노드 검사 없음)
 *      ⑥ 승인 파일·노드면 **어떤 작업이든** 통과 (작업 종류 검사 없음)
 *
 * v3 의 원칙
 *   · 모르면 막는다 (fail-closed)
 *   · 문자열 검색이 아니라 **필드에서 구조적으로 추출**해서 정확히 비교한다
 *   · 범위는 파일 · 노드 · 작업 종류 **세 축으로** 묶는다
 *
 * 승인 환경변수 (PowerShell)
 *   $env:FIGMA_MODE="staging"                       # staging | edit
 *   $env:FIGMA_WRITE="1"
 *   $env:FIGMA_WRITE_FILE="<fileKey>"                # 이 파일만
 *   $env:FIGMA_WRITE_NODE="3732:289"                # 이 노드(들)만 · 쉼표 구분
 *   $env:FIGMA_WRITE_OPS="use_figma"                # 이 작업만 · 쉼표 구분
 *   $env:FIGMA_WRITE_PARENT="3732:289"             # staging: 이 부모 아래에만
 *
 *   staging  새로 만들기. **어디에** 만드는지까지 묶는다.
 *            요청은 노드를 반드시 가리켜야 하고, 그 노드는 부모 또는 승인 노드여야 한다.
 *            신규 파일 생성이면 FIGMA_WRITE_PARENT="new-file" (기존 노드 참조 금지).
 *   edit     기존 원본 수정. 참조된 노드가 전부 승인 목록 안이어야 통과
 *
 *   v4 가 막는 것 ⑦: staging 인데 노드 참조가 없어 통과 → 승인 파일 안 아무 데나 생성
 *   v6 는 currentPage/root 직접 참조와 동적 getNodeById 인수를 차단한다.
 *
 * ── 훅이 강제할 수 없는 것 (정직하게 적어둔다) ──────────────────
 *   PreToolUse 입력에는 "지금 어느 스킬이 도는지"가 없다.
 *   따라서 **"검수 스킬은 쓰기 금지"를 훅이 강제할 수 없다.**
 *   그건 운영 규칙이다 — 검수는 이 환경변수들을 켜지 않은 세션에서 돌린다.
 *   변수가 없으면 훅이 모든 쓰기를 막으므로, 그 운영 규칙만 지키면 실효는 같다.
 *
 * 종료 코드   0 통과 · 2 차단
 */

const BLOCK = 2;
const PASS = 0;

/** 확인된 조회 전용 도구. 마지막 세그먼트 **정확히 일치**만 통과. */
const READ_ONLY = new Set([
  'get_design_context', 'get_screenshot', 'get_metadata', 'get_variable_defs',
  'get_figjam', 'get_motion_context', 'get_code_connect_map',
  'get_code_connect_suggestions', 'get_context_for_code_connect',
  'get_figma_skill', 'get_generative_plugin', 'get_shader', 'get_libraries',
  'get_figma_data', 'list_file_components_for_code_connect', 'list_file_shaders',
  'list_shaders', 'list_generative_plugins', 'search_design_system',
  'download_figma_images', 'download_assets', 'whoami',
  'weave_list_tools', 'weave_get_tool_inputs', 'weave_get_tool_run_output',
  // 인증은 파일 내용을 건드리지 않는다. OAuth 세션을 여는 동작일 뿐이고,
  // 사용자가 브라우저에서 직접 동의해야 한다. 이걸 막으면 검수 세션이
  // Figma 를 읽지 못해, **읽기만 하려고 쓰기 권한을 켜야 하는** 상황이 된다.
  // (2026-09-19 실전 시험에서 실제로 여기서 막혔다.)
  // 인증이 통과해도 create_new_file · use_figma 등 실제 쓰기는 그대로 막힌다.
  'authenticate',
]);

/** 파일 키가 들어 있는 필드 이름 (소문자·기호 제거 후 비교) */
const FILE_KEY_FIELDS = new Set(['filekey', 'filekeys', 'fileid', 'fromurl', 'typeurl']);
/** 노드 id 가 들어 있는 필드 이름 */
const NODE_FIELDS = new Set([
  'nodeid', 'nodeids', 'parentnodeid', 'targetnodeid', 'rootnodeid', 'ids',
]);
/**
 * 코드 본문에서도 노드 id 를 읽는 필드.
 *
 * use_figma 는 nodeId 파라미터가 **없다.** 파라미터는 fileKey · code · description 뿐이고,
 * 대상은 code 안의 자바스크립트로 지정된다 (getNodeByIdAsync("0:1") 같은 식).
 * 지정된 필드만 보면 노드를 못 찾아 staging 검사가 전부 막힌다 — 실제로 막혔다.
 *
 * 따옴표로 감싼 node id 패턴만 읽는다. 코드 안의 시각("10:30") 같은 것과 섞이지 않게
 * 하려는 게 아니라 — 그런 오탐은 차단 쪽이라 안전하다 — 주석·문장 속 숫자까지
 * 끌어오지 않기 위해서다.
 *
 * 이 추출은 검사를 **엄격하게** 만든다. 코드가 건드리는 노드가 하나라도 승인 목록
 * 밖이면 막힌다. 다만 코드가 노드 id 를 동적으로 계산하면 잡을 수 없다 —
 * 그건 PreToolUse 훅으로 막을 수 있는 범위가 아니다.
 */
const CODE_FIELDS = new Set(['code']);
const QUOTED_NODE_RE = /["'](\d+[:-]\d+)["']/g;

// 추출은 넉넉하게. 못 뽑으면 검증을 건너뛰게 되므로, 놓치는 쪽이 위험하다.
const FILE_URL_RE = /figma\.com\/(?:design|file|board|slides|make)\/([A-Za-z0-9]{6,128})/gi;
const NODE_URL_RE = /[?&]node-id=([0-9]+[:-][0-9]+)/gi;
const NODE_ID_RE = /^I?\d+[:-]\d+(?:;\d+[:-]\d+)*$/;

const NEW_FILE = 'new-file';

const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const normNode = (n) => String(n).trim().replace(/-/g, ':');

function die(lines) {
  process.stderr.write('\n' + lines.join('\n') + '\n');
  process.exit(BLOCK);
}

function lastSegment(name) {
  const parts = String(name).split('__');
  return (parts[parts.length - 1] || '').trim();
}

/**
 * 입력에서 파일 키와 노드 id 를 **구조적으로** 추출한다.
 * 전체 문자열을 뒤지지 않는다 — 메모 필드에 승인 키를 심는 우회를 막기 위해서다.
 * 파일 키는 지정된 필드 또는 figma.com URL 에서만,
 * 노드 id 는 지정된 필드 또는 URL 의 node-id 에서만 읽는다.
 */
function extractScope(input) {
  const files = new Set();
  const nodes = new Set();
  const codeBodies = [];

  const fromUrls = (s) => {
    for (const m of String(s).matchAll(FILE_URL_RE)) files.add(m[1]);
    for (const m of String(s).matchAll(NODE_URL_RE)) nodes.add(normNode(m[1]));
  };

  (function walk(value, keyName) {
    if (value === null || value === undefined) return;

    if (typeof value === 'string') {
      const k = norm(keyName);
      if (FILE_KEY_FIELDS.has(k)) files.add(value.trim());
      if (NODE_FIELDS.has(k)) {
        for (const part of value.split(',')) {
          const n = normNode(part);
          if (NODE_ID_RE.test(n)) nodes.add(n);
        }
      }
      if (CODE_FIELDS.has(k)) {
        codeBodies.push(value);
        for (const m of value.matchAll(QUOTED_NODE_RE)) nodes.add(normNode(m[1]));
      }
      // URL 은 어느 필드에 있든 읽는다 — URL 자체가 대상을 가리키기 때문
      if (/figma\.com/i.test(value)) fromUrls(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const v of value) walk(v, keyName);
      return;
    }

    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  })(input, '');

  return { files: [...files], nodes: [...nodes], codeBodies };
}

function unsafeCodeTarget(code) {
  if (/\bfigma\s*\.\s*(?:currentPage|root)\b/.test(code)) {
    return 'currentPage/root 직접 참조는 승인된 부모 범위를 우회할 수 있습니다';
  }
  const lookup = /\bgetNodeById(?:Async)?\s*\(([^)]*)\)/g;
  for (const match of code.matchAll(lookup)) {
    if (!/^\s*["']\d+[:-]\d+["']\s*$/.test(match[1])) {
      return '노드 조회 인수는 코드에 고정된 node ID 문자열이어야 합니다';
    }
  }
  return null;
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    die([
      '┌─ [하네스] 훅 입력을 해석하지 못했습니다 ─────────────────',
      '│  안전을 위해 차단합니다 (fail-closed).',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  const tool = typeof data?.tool_name === 'string' ? data.tool_name : '';
  if (!tool) {
    die([
      '┌─ [하네스] 도구 이름이 없습니다 ──────────────────────────',
      '│  안전을 위해 차단합니다 (fail-closed).',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  if (!/figma/i.test(tool)) process.exit(PASS);

  const seg = lastSegment(tool);
  if (READ_ONLY.has(seg)) process.exit(PASS);

  // ── 여기부터 쓰기(또는 모르는 도구). 세 축 전부 확인한다 ──────
  const mode = (process.env.FIGMA_MODE || '').trim();
  const allowWrite = process.env.FIGMA_WRITE === '1';
  const scopeFile = (process.env.FIGMA_WRITE_FILE || '').trim();
  const scopeNodes = new Set(
    (process.env.FIGMA_WRITE_NODE || '').split(',').map((s) => normNode(s)).filter(Boolean)
  );
  const scopeOps = new Set(
    (process.env.FIGMA_WRITE_OPS || '').split(',').map((s) => s.trim()).filter(Boolean)
  );

  const howTo = [
    '│  쓰려면 다섯 가지를 전부 지정한 별도 세션에서:',
    '│    $env:FIGMA_MODE="staging"     # 또는 edit',
    '│    $env:FIGMA_WRITE="1"',
    '│    $env:FIGMA_WRITE_FILE="<fileKey>"',
    '│    $env:FIGMA_WRITE_NODE="<nodeId>[,…]"',
    '│    $env:FIGMA_WRITE_OPS="<도구이름>[,…]"',
    '│    $env:FIGMA_WRITE_PARENT="<부모 노드>"   # staging · 신규 파일이면 "new-file"',
    '│',
    '│  검수(preflight)는 이 변수들을 켜지 않은 세션에서 돌린다.',
  ];

  if (!allowWrite) {
    die([
      '┌─ [하네스] Figma 쓰기가 차단되었습니다 ──────────────────',
      `│  도구: ${tool}`,
      READ_ONLY.size && !READ_ONLY.has(seg) ? '│  (조회 목록에 없는 도구입니다. 모르면 막습니다)' : '│',
      '│',
      ...howTo,
      '└──────────────────────────────────────────────────────',
    ]);
  }

  if (mode !== 'staging' && mode !== 'edit') {
    die([
      '┌─ [하네스] 쓰기 모드가 지정되지 않았습니다 ───────────────',
      `│  도구: ${tool}`,
      '│  FIGMA_MODE 는 "staging"(새로 만들기) 또는 "edit"(원본 수정) 이어야 합니다.',
      '│  모드를 나누는 이유: 원본 수정은 새로 만들기보다 훨씬 위험합니다.',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  // ── 축 3: 작업 종류 ──────────────────────────────────────────
  if (!scopeOps.size) {
    die([
      '┌─ [하네스] 허용 작업이 지정되지 않았습니다 ───────────────',
      `│  도구: ${tool}`,
      '│  FIGMA_WRITE_OPS 에 허용할 도구 이름을 적어주세요.',
      `│  예:  $env:FIGMA_WRITE_OPS="${seg}"`,
      '└──────────────────────────────────────────────────────',
    ]);
  }
  if (!scopeOps.has(seg)) {
    die([
      '┌─ [하네스] 승인되지 않은 작업입니다 ─────────────────────',
      `│  요청: ${seg}`,
      `│  승인: ${[...scopeOps].join(' · ')}`,
      '│  의도한 것이면 FIGMA_WRITE_OPS 에 추가하세요.',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  // ── 축 1: 파일 ───────────────────────────────────────────────
  if (!scopeFile) {
    die([
      '┌─ [하네스] 쓰기 대상 파일이 지정되지 않았습니다 ──────────',
      `│  도구: ${tool}`,
      '│  FIGMA_WRITE_FILE=<fileKey> 로 대상 파일을 묶어주세요.',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  const { files, nodes, codeBodies } = extractScope(data.tool_input ?? {});

  if (seg === 'use_figma') {
    for (const code of codeBodies) {
      const unsafeTarget = unsafeCodeTarget(code);
      if (unsafeTarget) {
        die([
          '┌─ [하네스] Figma 코드의 대상 범위를 검증할 수 없습니다 ──',
          `│  이유: ${unsafeTarget}`,
          '│  승인된 node ID를 명시하고 암묵·동적 대상을 제거하세요.',
          '└──────────────────────────────────────────────────────',
        ]);
      }
    }
  }

  if (!files.length) {
    die([
      '┌─ [하네스] 대상 파일을 확인할 수 없습니다 ────────────────',
      `│  도구: ${tool}`,
      '│  요청에서 fileKey 나 figma.com 주소를 찾지 못했습니다.',
      '│  범위를 검증할 수 없으므로 차단합니다 (fail-closed).',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  const badFile = files.find((f) => f !== scopeFile);
  if (badFile) {
    die([
      '┌─ [하네스] 승인 범위 밖 파일입니다 ──────────────────────',
      `│  요청 대상: ${files.join(' · ')}`,
      `│  승인된 파일: ${scopeFile}`,
      '│',
      '│  ※ 메모나 설명에 승인 키를 적어도 통과하지 않습니다.',
      '│    fileKey 필드와 figma.com 주소에서만 읽습니다.',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  // ── 축 4: 부모 — staging 은 "어디에" 만드는지까지 묶는다 ─────
  // 이게 없으면 승인된 회사 파일 안 아무 페이지에나 프레임이 생길 수 있다.
  const parentRaw = (process.env.FIGMA_WRITE_PARENT || '').trim();
  const scopeParent = parentRaw === NEW_FILE ? NEW_FILE : normNode(parentRaw);

  if (mode === 'staging') {
    if (!parentRaw) {
      die([
        '┌─ [하네스] staging 인데 부모가 지정되지 않았습니다 ───────',
        `│  도구: ${seg}`,
        '│  FIGMA_WRITE_PARENT 로 **어디에 만들지**를 묶어주세요.',
        '│    $env:FIGMA_WRITE_PARENT="<페이지·섹션 노드 id>"',
        '│    $env:FIGMA_WRITE_PARENT="new-file"   # 새 파일을 만드는 경우',
        '│',
        '│  파일만 묶으면 그 파일 **안 아무 데나** 만들어질 수 있습니다.',
        '└──────────────────────────────────────────────────────',
      ]);
    }

    if (scopeParent === NEW_FILE) {
      if (nodes.length) {
        die([
          '┌─ [하네스] 신규 파일 생성인데 기존 노드를 가리킵니다 ─────',
          `│  요청이 가리키는 노드: ${nodes.join(' · ')}`,
          '│  FIGMA_WRITE_PARENT="new-file" 은 기존 노드를 건드리지 않는 경우입니다.',
          '└──────────────────────────────────────────────────────',
        ]);
      }
    } else {
      if (!NODE_ID_RE.test(scopeParent)) {
        die([
          '┌─ [하네스] 부모 노드 id 형식이 아닙니다 ─────────────────',
          `│  받은 값: ${parentRaw}`,
          '│  "3732:289" 형태이거나 "new-file" 이어야 합니다.',
          '└──────────────────────────────────────────────────────',
        ]);
      }
      if (!nodes.length) {
        die([
          '┌─ [하네스] 어디에 만드는지 확인할 수 없습니다 ─────────────',
          `│  도구: ${seg}`,
          `│  승인된 부모: ${scopeParent}`,
          '│  요청이 노드를 하나도 가리키지 않아 위치를 검증할 수 없습니다.',
          '│',
          '│  use_figma 라면 **코드 안에 부모 노드 id 를 문자열로 명시**하세요.',
          `│    const parent = await figma.getNodeByIdAsync("${scopeParent}");`,
          '│    parent.appendChild(frame);',
          '│',
          '│  figma.currentPage 처럼 암묵적으로 쓰면 어디에 생기는지 알 수 없습니다.',
          '└──────────────────────────────────────────────────────',
        ]);
      }
    }
  }

  // ── 축 2: 노드 ───────────────────────────────────────────────
  // 부모는 자동으로 허용 목록에 든다 (그 아래에 만드는 게 목적이므로).
  const allowedNodes = new Set(scopeNodes);
  if (scopeParent && scopeParent !== NEW_FILE) allowedNodes.add(scopeParent);

  if (nodes.length) {
    if (!allowedNodes.size) {
      die([
        '┌─ [하네스] 대상 노드가 지정되지 않았습니다 ───────────────',
        `│  요청이 가리키는 노드: ${nodes.join(' · ')}`,
        '│  FIGMA_WRITE_NODE 로 승인된 노드를 묶어주세요.',
        '└──────────────────────────────────────────────────────',
      ]);
    }
    const bad = nodes.filter((n) => !allowedNodes.has(n));
    if (bad.length) {
      die([
        '┌─ [하네스] 승인 범위 밖 노드입니다 ──────────────────────',
        `│  요청: ${bad.join(' · ')}`,
        `│  승인: ${[...allowedNodes].join(' · ')}`,
        '│  다른 프레임을 건드리려는 것일 수 있습니다.',
        '└──────────────────────────────────────────────────────',
      ]);
    }
  } else if (mode === 'edit') {
    die([
      '┌─ [하네스] edit 모드인데 대상 노드가 없습니다 ────────────',
      `│  도구: ${seg}`,
      '│  원본 수정은 어느 노드를 고치는지 확인돼야 합니다.',
      '│  새로 만드는 작업이면 FIGMA_MODE="staging" 을 쓰세요.',
      '└──────────────────────────────────────────────────────',
    ]);
  }

  process.stderr.write(
    `[하네스] Figma 쓰기 허용 — ${seg}\n` +
      `         모드 ${mode} · 파일 ${scopeFile}` +
      (scopeParent === NEW_FILE ? ' · 신규 파일' : ` · 부모 ${scopeParent}`) +
      (nodes.length ? ` · 노드 ${nodes.join(',')}` : '') +
      `\n         버전을 "AI_CLAUDE_<YYMMDD>_<작업명>" 으로 찍었는지 확인하세요.\n`
  );
  process.exit(PASS);
});
