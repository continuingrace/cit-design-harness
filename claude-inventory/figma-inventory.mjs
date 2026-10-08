#!/usr/bin/env node
/**
 * figma-inventory.mjs — CiT 디자인 인벤토리 스캐너 (v5)
 *
 * 두 가지 일을 한다.
 *   ① 발견  — 규격별로 실제 값을 모아 최빈값을 뽑는다 (아직 정하지 않은 것을 찾기 위해)
 *   ② 판정  — spec.json 의 확정 규칙에 대고 검사한다 (이미 정한 것을 지키기 위해)
 *
 * v1~v4 에서 배운 것 (같은 실수를 반복하지 않기 위해 남긴다)
 *   v1  절대 기준으로 판정 → 4932개 중 3668 FAIL. 누적 파일에 74% FAIL은 정보가 아니다
 *   v2  2패스 + 올해 작업만 FAIL
 *   v3  자간은 글자 크기가 아니라 규격마다 다르다
 *   v4  반반이면 표준이 아니다 (최빈값이 2위를 1.5배 못 넘기면 '미확립')
 *   v5  확정된 것은 빈도가 아니라 spec.json 을 따른다. 템플릿을 이름으로 구분한다
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  읽기 전용 보장                                               │
 * │  - HTTP GET 만 호출한다 (http() 가 method 인자를 받지 않음)   │
 * │  - Figma 쓰기 API 를 import 하지 않는다                       │
 * │  - 원본 파일을 열거나 수정하거나 이동하지 않는다              │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 사용법
 *   $env:FIGMA_TOKEN="figd_..."          # PowerShell · 읽기 전용 PAT
 *   node figma-inventory.mjs             # files.json 전체
 *   node figma-inventory.mjs --file "팀 A (예시)"
 *   node figma-inventory.mjs --refetch   # 캐시 무시하고 다시 받기 (분기 재확인용)
 *   node figma-inventory.mjs --all       # 제외 파일(files.json 의 excludeFiles)까지 포함
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.FIGMA_TOKEN;
const CACHE_DIR = '.cache';
const OUT_DIR = 'out';

/** 최빈값을 '표준'이라 부르기 위한 조건 */
const MIN_FREQ = 5;
const MIN_SHARE = 0.35;
const MODE_MARGIN = 1.5; // 2위와 엇비슷하면 표준이 아니라 '미확립'

const UNNAMED = /^(Frame|Group|Rectangle|Component)\b/i;

// ── HTTP (GET 전용) ─────────────────────────────────────────────────

async function http(endpoint) {
  const res = await fetch(`https://api.figma.com/v1${endpoint}`, {
    headers: { 'X-Figma-Token': TOKEN },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${endpoint} → ${res.status}\n${body.slice(0, 400)}`);
  }
  return res.json();
}

async function fetchFile(label, fileKey, refetch) {
  const cachePath = path.join(CACHE_DIR, `${fileKey}.json`);
  if (!refetch && existsSync(cachePath)) {
    process.stderr.write(`  ${label}: 캐시 사용\n`);
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  process.stderr.write(`  ${label}: 내려받는 중…\n`);
  const data = await http(`/files/${fileKey}`);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(data));
  return data;
}

// ── 유틸 ────────────────────────────────────────────────────────────

const isArtboard = (n) => n.type === 'FRAME' || n.type === 'COMPONENT';
const hasKorean = (s) => /[ㄱ-ㆎ가-힣]/.test(s || '');

function isUpperLatinLabel(s) {
  const t = (s || '').trim();
  return t.length > 0 && !hasKorean(t) && t === t.toUpperCase() && /[A-Z]/.test(t);
}

function sizeKey(node) {
  const b = node.absoluteBoundingBox;
  return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : null;
}

/** 프레임명 앞의 날짜를 YYMMDD 문자열로. 260409_… → "260409",  20260518_… → "260518" */
function frameDate(name) {
  let m = /^(\d{4})(\d{2})(\d{2})_/.exec(name);
  if (m) return m[1].slice(2) + m[2] + m[3];
  m = /^(\d{2})(\d{2})(\d{2})_/.exec(name);
  return m ? m[1] + m[2] + m[3] : null;
}

/** 프레임명 앞의 연도. 260409_… → 26 */
function frameYear(name) {
  const d = frameDate(name);
  return d ? Number(d.slice(0, 2)) : null;
}

const bump = (map, k) => {
  if (k === null || k === undefined) return;
  map.set(k, (map.get(k) || 0) + 1);
};
const top = (map, n = 12) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function modeOf(map) {
  const t = top(map, 2);
  if (!t.length) return null;
  const [first, second] = t;
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  if (first[1] < MIN_FREQ || first[1] / total < MIN_SHARE) return null;
  if (second && first[1] < second[1] * MODE_MARGIN) return null;
  return { value: first[0], count: first[1], share: first[1] / total };
}

// ── 템플릿 매칭 ─────────────────────────────────────────────────────

/**
 * 아트보드가 어느 템플릿인지 결정한다.
 * spec.templates 를 위에서부터 훑어 규격이 같고 이름 패턴이 맞는 첫 번째를 쓴다.
 * match:"*" 는 그 규격의 기본값이다.
 */
function matchTemplate(spec, size, name) {
  for (const t of spec.templates) {
    if (t.size !== size) continue;
    if (t.match === '*') return t;
    if (new RegExp(t.match, 'i').test(name)) return t;
  }
  return null;
}

// ── 수집 ────────────────────────────────────────────────────────────

/**
 * 산출물 identity — 이 프레임이 "무엇인가" 를 나타내는 지문.
 *
 * 문구 · 색 · 이미지 · 규격 네 축을 모두 넣는다. 텍스트만 넣으면 틀릴 수 있다(예시 서사) —
 * 문구가 같은 프레임 그룹인데 배경색이 다른 A/B 안이었던 사례, 텍스트가 없는데 이미지가
 * 달랐던 사례가 있었다. 규격을 빼면 리사이즈 버전이 같은 것으로 샌다.
 */
function outputIdentity(artboard) {
  const texts = [], fills = [], images = [];
  (function walk(n) {
    if (n.type === 'TEXT' && n.characters) texts.push(n.characters.trim());
    for (const f of n.fills || []) {
      if (f.visible === false) continue;
      if (f.type === 'SOLID' && f.color) {
        const c = f.color;
        fills.push([c.r, c.g, c.b, f.opacity ?? 1].map((v) => Math.round(v * 255)).join(','));
      }
      if (f.type === 'IMAGE' && f.imageRef) images.push(f.imageRef);
      for (const st of f.gradientStops || []) if (st.color) fills.push('g' + Object.values(st.color).map((v) => Math.round(v * 255)).join(','));
    }
    for (const c of n.children || []) walk(c);
  })(artboard);
  const b = artboard.absoluteBoundingBox || {};
  const size = `${Math.round(b.width ?? 0)}x${Math.round(b.height ?? 0)}`;
  return createHash('sha1')
    .update([texts.join('\u0000'), '|', fills.join(','), '|', images.join(','), '|', size].join(''))
    .digest('hex')
    .slice(0, 12);
}

function collectTexts(artboard) {
  const o = artboard.absoluteBoundingBox;
  const out = [];
  (function walk(node) {
    if (node.type === 'TEXT') {
      const s = node.style || {};
      const b = node.absoluteBoundingBox;
      const chars = node.characters || '';
      out.push({
        id: node.id,
        chars: chars.replace(/\s+/g, ' ').slice(0, 36),
        font: s.fontFamily ?? null,
        weight: s.fontWeight ?? null,
        size: s.fontSize ?? null,
        letterSpacing: s.letterSpacing ?? 0,
        lineHeightPx: s.lineHeightPx ?? null,
        align: s.textAlignHorizontal ?? null,
        x: b && o ? +(b.x - o.x).toFixed(2) : null,
        y: b && o ? +(b.y - o.y).toFixed(2) : null,
        h: b ? b.height : 0,
        korean: hasKorean(chars),
        upperLatin: isUpperLatinLabel(chars),
      });
    }
    for (const c of node.children || []) walk(c);
  })(artboard);
  return out;
}

function gather(files, spec) {
  const boards = [];
  for (const { label, doc } of files) {
    for (const page of doc.document.children || []) {
      if (page.type !== 'CANVAS') continue;
      for (const node of page.children || []) {
        if (!isArtboard(node)) continue;
        const size = sizeKey(node);
        if (!size) continue;
        boards.push({
          file: label,
          page: page.name,
          id: node.id,
          name: node.name,
          size,
          year: frameYear(node.name),
          date: frameDate(node.name),
          height: node.absoluteBoundingBox.height,
          template: matchTemplate(spec, size, node.name),
          texts: collectTexts(node),
          identity: outputIdentity(node),
        });
      }
    }
  }
  return boards;
}

// ── 패스 1 · 발견 (아직 정하지 않은 것 찾기) ───────────────────────

function deriveStandards(boards, spec) {
  const bySize = new Map();
  for (const b of boards) {
    if (!bySize.has(b.size)) {
      bySize.set(b.size, {
        size: b.size, count: 0, current: 0, pages: new Set(),
        fonts: new Map(), sizes: new Map(), weights: new Map(),
        tracking: new Map(), leading: new Map(), aligns: new Map(), leftX: new Map(),
      });
    }
    const k = bySize.get(b.size);
    k.count++;
    if (b.year !== null && b.year >= spec.currentSinceYY) k.current++;
    k.pages.add(`${b.file} / ${b.page}`);
    for (const t of b.texts) {
      bump(k.fonts, t.font);
      bump(k.sizes, t.size);
      bump(k.weights, `${t.font} ${t.weight}`);
      bump(k.aligns, t.align);
      if (t.align === 'LEFT' && t.x !== null) bump(k.leftX, Math.round(t.x));
      if (t.size) bump(k.tracking, +(t.letterSpacing / t.size).toFixed(4));
      if (t.size && t.lineHeightPx) bump(k.leading, (t.lineHeightPx / t.size).toFixed(2));
    }
  }
  for (const k of bySize.values()) {
    k.stdLeftX = modeOf(k.leftX);
    k.stdFont = modeOf(k.fonts);
    k.stdTracking = modeOf(k.tracking);
    k.stdAlign = modeOf(k.aligns);
  }
  return bySize;
}

// ── 패스 2 · 판정 (이미 정한 것 지키기) ────────────────────────────

/**
 * 자간 severity — 디자인 규칙(target)과 검사 허용오차(구간)를 분리한다.
 * design-language.md §3-1. 구간 정의는 spec.json tracking.severity.
 * 빈틈 없이 실수 전체를 덮는다: PASS / WARN / REVIEW / FAIL 중 정확히 하나.
 */
function trackingSeverity(t, S) {
  const e = S.epsilon ?? 1e-6;
  if (Math.abs(t - S.target) <= e) return 'PASS';
  if (t <= S.reviewLo + e) return 'FAIL';   // t <= -4%
  if (t > S.reviewHi + e) return 'FAIL';    // t > 0%
  if (t >= S.warnLo - e && t <= S.warnHi + e) return 'WARN'; // -3% <= t <= -1%
  return 'REVIEW';                          // -4% < t < -3%  또는  -1% < t <= 0%
}

function judge(boards, bySize, spec) {
  const v = [];
  const push = (o) => v.push(o);
  const allowedFonts = [spec.fonts.primary, ...(spec.fonts.allowedExtra || [])];
  const tol = spec.tracking.tolerance;

  // 이름 중복
  const nameIndex = new Map();
  for (const b of boards) {
    const key = `${b.file}\u0000${b.page}\u0000${b.name}`;
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(b);
  }
  for (const [key, group] of nameIndex) {
    if (group.length < 2) continue;
    const name = key.split('\u0000')[2];
    const unnamed = UNNAMED.test(name);
    const current = group.some((b) => b.year >= spec.currentSinceYY);

    /**
     * 같은 이름이 여럿인 것이 곧 오류는 아니다. design-language.md §14.
     *
     *   k = 서로 다른 산출물의 종류 수 (문구·색·이미지·규격 지문 기준)
     *   n = 노드 수
     *
     *   k === 1   같은 것에 같은 이름이 붙은 것. 이름 문제가 아니라 파일 정리 문제다
     *             → 시각적 중복 객체 후보 (WARN). 자동 삭제·rename 대상이 아니다
     *   k >= 2    서로 다른 산출물이 같은 이름을 쓴다. export 파일명이 부딪히고 사람이 구분하지 못한다
     *             → 프레임명 중복 (FAIL). k === n 이면 all-distinct, 아니면 mixed
     */
    const k = new Set(group.map((b) => b.identity)).size;
    const isVisualDup = !unnamed && k === 1;
    const subtype = unnamed ? null : k === group.length ? 'all-distinct' : 'mixed';

    push({
      severity: unnamed ? 'WARN' : !current ? 'INFO' : isVisualDup ? 'WARN' : 'FAIL',
      rule: unnamed ? '이름 미지정' : isVisualDup ? '시각적 중복 객체 후보' : '프레임명 중복',
      scope: current ? '현행' : '과거',
      ...(unnamed ? {} : { subtype: isVisualDup ? 'visual-equivalent-candidate' : subtype }),
      ...(!unnamed && !isVisualDup && subtype === 'mixed' ? { needsReview: true } : {}),
      ...(unnamed ? {} : { distinctOutputs: k }),
      file: group[0].file, page: group[0].page, frame: name,
      current: `${group.length}개`,
      /**
       * 특정 접미사 형식을 강제하지 않는다.
       * 실측(2026-09-30)에서 중복 162그룹 중 134그룹이 A/B 안이 아니라 서로 다른 산출물이었다.
       * `260602_메타광고_기업코칭A` 7개는 7개의 다른 광고 소재다 — _A~_G 를 붙이라는 건 실태와 안 맞는다.
       * 무엇으로 구분할지는 그 산출물이 실제로 무엇이 다른지에 달렸다.
       */
      expected: unnamed
        ? '{YYMMDD}_{종류}_{본부}_{번호}_{버전}'
        : isVisualDup
        ? '시각적으로 거의 같은 프레임이 같은 페이지에 여러 개 있는 이유를 확인한다. 의도된 백업·대안이면 그대로 둔다. 자동 삭제·rename 대상이 아니다'
        : '동일 페이지 내 서로 다른 산출물은 export 와 사람 식별이 가능하도록 고유한 프레임명을 쓴다. 회차·채널·버전·규격 등 실제 차이를 설명하는 식별자를 쓴다',
      nodes: group.map((b) => b.id).slice(0, 6),
    });
  }

  for (const b of boards) {
    const isCurrent = b.year !== null && b.year >= spec.currentSinceYY;
    const sev = (s) => (isCurrent ? s : 'INFO');
    const scope = isCurrent ? '현행' : b.year === null ? '날짜없음' : '과거';
    const tpl = b.template;
    const trackingExempt = Object.prototype.hasOwnProperty.call(spec.tracking.exemptSizes || {}, b.size);
    /**
     * 새로 정한 규칙(좌마진·하단 금지영역)은 발효일 이후 작업에만 매긴다.
     * 그 전 것은 규칙이 없던 시절의 작업이라 위반이 아니다 — 참고로만 남긴다.
     */
    const afterEffective = spec.effectiveFrom ? b.date !== null && b.date >= spec.effectiveFrom : true;
    const newRuleSev = (s) => (afterEffective ? sev(s) : 'INFO');

    if (b.year === null && !UNNAMED.test(b.name)) {
      push({
        severity: 'WARN', rule: '이름 규약 이탈', scope,
        file: b.file, page: b.page, frame: b.name,
        current: b.name.slice(0, 40), expected: '{YYMMDD}_ 로 시작', nodes: [b.id],
      });
    }

    for (const t of b.texts) {
      if (!t.size) continue;

      // 서체
      if (t.font && !allowedFonts.some((f) => t.font.startsWith(f))) {
        push({
          severity: sev('WARN'), rule: '보조 서체 사용', scope, template: tpl?.id,
          file: b.file, page: b.page, frame: b.name,
          detail: `"${t.chars}"`, current: t.font, expected: allowedFonts.join(' / '),
          nodes: [t.id],
        });
      }

      // 자간 — 확정 규칙. 단 exemptSizes 는 건너뛴다
      if (!trackingExempt) {
        const ratio = +(t.letterSpacing / t.size).toFixed(4);
        // 영문 대문자 라벨은 표본이 12회뿐이라 표준이 없다 → 판정하지 않는다.
        // 표본 1개로 +3% 를 확정했다가 본문 영문이 전부 오탐으로 걸린 전례가 있다.
        const exp = t.upperLatin
          ? spec.tracking.judgeEnUpperLabel === false
            ? null
            : spec.tracking.enUpperLabel ?? null
          : t.korean
          ? spec.tracking.ko
          : null;
        const zero = t.letterSpacing === 0;
        const S = spec.tracking.severity;
        // 자간 이탈만 4단계로 본다. 미설정(정확히 0)은 기존대로 WARN 한 종류.
        const lvl = exp !== null && !zero && S ? trackingSeverity(ratio, S) : null;
        const hit = exp !== null && (S && !zero ? lvl !== 'PASS' : Math.abs(ratio - exp) > tol);
        if (hit) {
          push({
            severity: sev(zero ? 'WARN' : lvl ?? 'FAIL'),
            rule: zero ? '자간 미설정' : '자간 이탈',
            scope, template: tpl?.id,
            file: b.file, page: b.page, frame: b.name,
            detail: `${t.size}px "${t.chars}"`,
            current: `${(ratio * 100).toFixed(1)}%`,
            expected: `${(exp * 100).toFixed(0)}%`,
            nodes: [t.id],
          });
        }
      }

      // 좌측 마진 — 템플릿에 선언된 값이 있으면 그것을, 없으면 판정하지 않는다
      if (tpl?.leftMargin && t.align === 'LEFT' && t.x !== null) {
        const d = Math.abs(t.x - tpl.leftMargin);
        if (d > spec.alignTolerance && d < 40) {
          push({
            severity: newRuleSev('FAIL'), rule: '좌측 마진 이탈', scope, template: tpl.id,
            file: b.file, page: b.page, frame: b.name,
            detail: `"${t.chars}"`,
            current: `x=${t.x}`, expected: `x=${tpl.leftMargin}`,
            nodes: [t.id],
          });
        }
      }

      // 하단 예약 영역 — 광고형처럼 bottomReservedPx 가 선언된 템플릿만
      if (tpl?.bottomReservedPx && t.y !== null) {
        const limit = b.height - tpl.bottomReservedPx;
        if (t.y + t.h > limit) {
          push({
            severity: newRuleSev('FAIL'), rule: '하단 금지영역 침범', scope, template: tpl.id,
            file: b.file, page: b.page, frame: b.name,
            detail: `"${t.chars}"`,
            current: `y=${Math.round(t.y + t.h)}`,
            expected: `y ≤ ${Math.round(limit)} (하단 ${tpl.bottomReservedPx}px 비움)`,
            nodes: [t.id],
          });
        }
      }
    }
  }
  return v;
}

// ── 리포트 ──────────────────────────────────────────────────────────

function renderReport(boards, bySize, violations, files, spec, excluded) {
  const L = [];
  const today = new Date().toISOString().slice(0, 10);
  const cur = boards.filter((b) => b.year !== null && b.year >= spec.currentSinceYY).length;
  const cnt = (s) => violations.filter((v) => v.severity === s).length;

  L.push('# CiT 디자인 인벤토리 리포트');
  L.push('');
  L.push(`${today} · 파일 ${files.length} · 아트보드 ${boards.length} (현행 20${spec.currentSinceYY}년~ ${cur})`);
  L.push(`기준: **${spec.source}**`);
  L.push('');
  L.push(`**FAIL ${cnt('FAIL')} · REVIEW ${cnt('REVIEW')} · WARN ${cnt('WARN')} · 참고 ${cnt('INFO')}**`);
  L.push('');
  if (excluded.length) L.push(`제외: ${excluded.join(' · ')}`);
  L.push('');
  L.push('> FAIL/WARN 은 **현행 작업**에만 매긴다. 과거 작업은 역사지 위반이 아니다.');
  L.push('> Figma 는 읽기만 했다. 원본은 열지도 바꾸지도 않았다.');
  L.push('');
  L.push('---');
  L.push('');

  // 확정 규칙 준수 현황
  L.push('## 1. 확정 규칙 준수');
  L.push('');
  L.push('| 규칙 | 기준 | 현행 FAIL |');
  L.push('|---|---|---:|');
  const fc = (rule) => violations.filter((v) => v.severity === 'FAIL' && v.rule === rule).length;
  const rc = (rule) => violations.filter((v) => v.severity === 'REVIEW' && v.rule === rule).length;
  const wc = (rule) => violations.filter((v) => v.severity === 'WARN' && v.rule === rule).length;
  L.push(`| 국문 자간 (목표 ${(spec.tracking.ko * 100).toFixed(0)}%) | FAIL ≤-4% 또는 >0% | ${fc('자간 이탈')} |`);
  L.push(`| 　└ REVIEW | -4%<t<-3% 또는 -1%<t≤0% | ${rc('자간 이탈')} |`);
  L.push(`| 　└ WARN (실무 편차) | -3%≤t≤-1% | ${wc('자간 이탈')} |`);
  L.push(`| 서체 | ${spec.fonts.primary} | ${violations.filter((v) => v.severity === 'WARN' && v.rule === '보조 서체 사용').length} (WARN) |`);
  for (const t of spec.templates) {
    if (!t.leftMargin) continue;
    const n = violations.filter((v) => v.severity === 'FAIL' && v.rule === '좌측 마진 이탈' && v.template === t.id).length;
    L.push(`| ${t.label} 좌마진 | ${t.leftMargin}px | ${n} |`);
  }
  const bn = violations.filter((v) => v.severity === 'FAIL' && v.rule === '하단 금지영역 침범').length;
  L.push(`| 광고 하단 금지영역 | 250px | ${bn} |`);
  const st = (sub) => violations.filter((v) => v.severity === 'FAIL' && v.rule === '프레임명 중복' && v.subtype === sub).length;
  L.push(`| 프레임명 중복 | 동일 페이지 내 고유명 (실제 차이를 설명하는 식별자) | ${fc('프레임명 중복')} |`);
  L.push(`| 　└ all-distinct | 모든 노드가 서로 다른 산출물 | ${st('all-distinct')} |`);
  L.push(`| 　└ mixed | 일부는 복제, 일부는 다른 산출물 | ${st('mixed')} |`);
  L.push(`| 시각적 중복 객체 후보 (WARN) | 같은 것이 여럿인 이유를 확인 · 자동 삭제·rename 금지 | ${wc('시각적 중복 객체 후보')} |`);
  L.push('');

  // 템플릿별 집계
  L.push('## 2. 템플릿 분류');
  L.push('');
  const byTpl = new Map();
  for (const b of boards) {
    const k = b.template ? b.template.label : `(미분류) ${b.size}`;
    byTpl.set(k, (byTpl.get(k) || 0) + 1);
  }
  L.push('| 템플릿 | 아트보드 |');
  L.push('|---|---:|');
  for (const [k, n] of [...byTpl.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 15)) {
    L.push(`| ${k} | ${n} |`);
  }
  L.push('');

  // 발견 — 아직 안 정한 것
  L.push('## 3. 규격별 실측 — 아직 정하지 않은 것');
  L.push('');
  L.push('확정 규칙이 없는 항목은 여기서 최빈값을 본다. `표준 미확립`은 값이 반반이라 정할 게 남았다는 뜻.');
  L.push('');
  for (const b of [...bySize.values()].sort((a, b2) => b2.count - a.count)) {
    if (b.count < MIN_FREQ) continue;
    L.push(`### ${b.size} — ${b.count}개 (현행 ${b.current})`);
    L.push('');
    L.push(`${[...b.pages].slice(0, 4).join(' · ')}`);
    L.push('');
    L.push('| 항목 | 표준 | 그 외 |');
    L.push('|---|---|---|');
    const row = (label, map, fmt = (k) => k, std = null) => {
      const t = top(map, 7);
      if (!t.length) return;
      const head = std ? `**${fmt(std.value)}** (${(std.share * 100).toFixed(0)}%)` : `**${fmt(t[0][0])}**×${t[0][1]}`;
      const rest = t.filter(([k]) => !std || k !== std.value).slice(0, 6)
        .map(([k, n]) => `${fmt(k)}×${n}`).join(' · ');
      L.push(`| ${label} | ${head} | ${rest} |`);
    };
    row('서체', b.fonts, (k) => k, b.stdFont);
    row('글자 크기', b.sizes, (k) => `${k}px`);
    row('웨이트', b.weights);
    row('자간', b.tracking, (k) => `${(k * 100).toFixed(1)}%`, b.stdTracking);
    row('행간', b.leading, (k) => `${k}배`);
    row('정렬', b.aligns, (k) => k, b.stdAlign);
    if (b.stdLeftX) row('좌측 마진', b.leftX, (k) => `${k}px`, b.stdLeftX);
    else L.push('| 좌측 마진 | *표준 미확립* | ' + top(b.leftX, 5).map(([k, n]) => `${k}×${n}`).join(' · ') + ' |');
    L.push('');
  }

  // 이탈
  L.push('---');
  L.push('');
  L.push('## 4. 이탈 목록');
  L.push('');
  for (const sevName of ['FAIL', 'REVIEW', 'WARN']) {
    const list = violations.filter((v) => v.severity === sevName);
    if (!list.length) continue;
    L.push(`### ${sevName} — ${list.length}건`);
    L.push('');
    const byRule = new Map();
    for (const v of list) {
      if (!byRule.has(v.rule)) byRule.set(v.rule, []);
      byRule.get(v.rule).push(v);
    }
    for (const [rule, vs] of [...byRule.entries()].sort((a, b2) => b2[1].length - a[1].length)) {
      L.push(`#### ${rule} — ${vs.length}건`);
      L.push('');
      L.push('| 파일 / 페이지 | 프레임 | 현재 | 기준 | 노드 |');
      L.push('|---|---|---|---|---|');
      for (const v of vs.slice(0, 30)) {
        L.push(`| ${v.file} / ${v.page} | ${v.frame}${v.detail ? ` · ${v.detail}` : ''} | ${v.current} | ${v.expected} | \`${v.nodes[0]}\` |`);
      }
      if (vs.length > 30) L.push(`| … | (외 ${vs.length - 30}건 — inventory.json) | | | |`);
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push('## 5. 다음 할 일');
  L.push('');
  L.push('1. §1 의 FAIL 이 0 이 아니면 — 규칙을 고칠지 작업을 고칠지 판단한다.');
  L.push('   **같은 규칙에서 FAIL 이 계속 쌓이면 대개 규칙이 틀린 것이다.**');
  L.push('2. §3 의 `표준 미확립` 중 자주 쓰는 규격부터 값을 정한다.');
  L.push('3. 정한 값은 `spec.json` 과 `design-language.md` **양쪽에** 적는다.');

  return L.join('\n');
}

// ── 실행 ────────────────────────────────────────────────────────────

async function main() {
  if (!TOKEN) {
    console.error('FIGMA_TOKEN 이 없습니다. README.md 1번 참조.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const refetch = args.includes('--refetch');
  const includeAll = args.includes('--all');
  const only = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

  const spec = JSON.parse(await readFile('spec.json', 'utf8'));
  const registry = JSON.parse(await readFile('files.json', 'utf8'));

  const excluded = [];
  const entries = Object.entries(registry).filter(([label]) => {
    if (only) return label === only;
    if (!includeAll && spec.excludeFiles?.[label]) {
      excluded.push(`${label} (${spec.excludeFiles[label]})`);
      return false;
    }
    return true;
  });

  if (!entries.length) {
    console.error(`대상 없음. files.json 키: ${Object.keys(registry).join(', ')}`);
    process.exit(1);
  }

  process.stderr.write(`기준 ${spec.source}\n파일 ${entries.length}개 스캔\n`);
  const files = [];
  const fetchFailures = [];
  for (const [label, fileKey] of entries) {
    try {
      files.push({ label, fileKey, doc: await fetchFile(label, fileKey, refetch) });
    } catch (e) {
      fetchFailures.push(label);
      process.stderr.write(`  ${label}: 실패 — ${e.message}\n`);
    }
  }
  // Do not publish a plausible-looking partial inventory: every requested source is
  // part of the configured audit scope, and a missed source can hide violations.
  if (fetchFailures.length) {
    process.stderr.write(`스캔 중단 — ${fetchFailures.length}/${entries.length}개 파일을 읽지 못했습니다. 기존 보고서는 갱신하지 않았습니다.\n`);
    process.exit(1);
  }
  if (!files.length) process.exit(1);

  const boards = gather(files, spec);
  const bySize = deriveStandards(boards, spec);
  const violations = judge(boards, bySize, spec);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, 'inventory.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        spec: spec.source,
        excluded,
        files: files.map((f) => ({ label: f.label, fileKey: f.fileKey })),
        artboards: boards.length,
        bySize: [...bySize.values()].map((b) => ({
          size: b.size, count: b.count, current: b.current, pages: [...b.pages],
          standards: { leftX: b.stdLeftX, font: b.stdFont, tracking: b.stdTracking, align: b.stdAlign },
          fonts: Object.fromEntries(b.fonts), sizes: Object.fromEntries(b.sizes),
          weights: Object.fromEntries(b.weights), tracking: Object.fromEntries(b.tracking),
          leading: Object.fromEntries(b.leading), aligns: Object.fromEntries(b.aligns),
          leftX: Object.fromEntries(b.leftX),
        })),
        violations,
      },
      null,
      2
    )
  );
  await writeFile(path.join(OUT_DIR, 'inventory-report.md'), renderReport(boards, bySize, violations, files, spec, excluded));

  const c = (s) => violations.filter((v) => v.severity === s).length;
  process.stderr.write(
    `\n완료 — 아트보드 ${boards.length} · FAIL ${c('FAIL')} · REVIEW ${c('REVIEW')} · WARN ${c('WARN')} · 참고 ${c('INFO')}\n` +
      `  out/inventory-report.md\n`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
