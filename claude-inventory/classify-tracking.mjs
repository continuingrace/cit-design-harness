#!/usr/bin/env node
/**
 * classify-tracking.mjs — 자간 FAIL 후보를 관찰값과 추정값으로 분리해 기록한다.
 *
 * 원칙 (design-language.md §3-1)
 *   observed — 인벤토리 데이터에 그대로 있는 값. 다툼의 여지가 없다.
 *   inferred — 크기·문구로 내가 추정한 것. 틀릴 수 있다. confidence 를 반드시 같이 적는다.
 *   둘을 한 칸에 섞지 않는다. 섞는 순간 추정이 사실로 굳는다.
 *
 * 읽기만 한다. Figma 를 호출하지 않는다.
 *
 * 생성물과 기록물을 나눈다
 *   out/    재생성 가능. inventory.json 만 있으면 언제든 다시 만든다. .gitignore 대상
 *   audit/  재생성 불가능. 사람이 Figma 실물을 보고 내린 판단이라 다시 만들 수 없다. 커밋한다
 *   이 스크립트는 audit/ 의 verdict 를 읽어서 out/ 에 합쳐준다. audit/ 을 쓰지는 않는다.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';

const inv = JSON.parse(await readFile('out/inventory.json', 'utf8'));

/** audit/ 의 모든 검증 라운드를 노드 id 기준으로 합친다 */
const verdicts = new Map();
try {
  for (const f of (await readdir('audit')).filter((x) => x.endsWith('.json')).sort()) {
    const a = JSON.parse(await readFile(`audit/${f}`, 'utf8'));
    for (const [id, v] of Object.entries(a.verdicts || {})) verdicts.set(id, { ...v, round: a.round, source: f });
  }
} catch {}

// detail 형식: `36px "문구"`
const parseDetail = (s = '') => {
  const m = s.match(/^([\d.]+)px\s+"([\s\S]*)"$/);
  return m ? { size: parseFloat(m[1]), text: m[2] } : { size: null, text: s };
};

/** 관찰값 — 문자 구성. 문자열을 보면 바로 나오는 사실이다. */
function scriptType(t) {
  const ko = /[가-힣]/.test(t);
  const la = /[A-Za-z]/.test(t);
  const di = /[0-9]/.test(t);
  const kinds = [ko && '국문', la && '영문', di && '숫자'].filter(Boolean);
  if (kinds.length === 0) return '기호·공백';
  if (kinds.length === 1) return kinds[0];
  return kinds.join('+');
}

/**
 * 추정값 — 역할. 인벤토리에는 역할 라벨이 없다. 크기와 문구 길이로 추정할 뿐이다.
 * 규칙을 코드로 적어두는 이유: 나중에 "왜 이렇게 봤나"를 되짚을 수 있어야 해서다.
 */
function inferRole(size, text, script) {
  const n = (text || '').trim().length;
  if (size === null) return { role: '알 수 없음', confidence: 'none', basis: '크기 없음' };
  if (size >= 60) return { role: '제목', confidence: 'high', basis: `${size}px — 본문 크기대를 크게 벗어남` };
  if (size >= 40) return { role: '제목', confidence: 'medium', basis: `${size}px — 제목대이나 큰 본문일 수 있음` };
  if (size <= 18) return { role: '캡션·주석', confidence: 'medium', basis: `${size}px — 최소 크기대` };
  if (n <= 6 && script !== '국문') return { role: '라벨·수치', confidence: 'low', basis: `${n}자 단문 · ${script}` };
  if (n <= 8) return { role: '라벨·CTA 가능', confidence: 'low', basis: `${size}px · ${n}자 단문` };
  if (n >= 25) return { role: '본문', confidence: 'medium', basis: `${size}px · ${n}자 장문` };
  return { role: '소제목·본문 구분 안 됨', confidence: 'low', basis: `${size}px · ${n}자` };
}

const rows = inv.violations
  .filter((v) => v.rule === '자간 이탈' && v.severity === 'FAIL')
  .map((v0) => {
    const v = v0;
    const { size, text } = parseDetail(v.detail);
    const tracking = parseFloat(v.current) / 100;
    const script = scriptType(text);
    const inf = inferRole(size, text, script);
    return {
      observed: {
        file: v.file, page: v.page, frame: v.frame,
        nodeId: v.nodes?.[0] ?? null,
        fontSize: size,
        tracking,
        trackingLabel: v.current,
        text,
        charCount: (text || '').trim().length,
        scriptType: script,
        bucket: tracking > 0 ? '양수' : '≤-4%',
      },
      inferred: { role: inf.role, confidence: inf.confidence, basis: inf.basis },
      verification: (() => {
        const v = verdicts.get(v0.nodes?.[0]);
        return v
          ? { status: 'done', method: 'figma get_screenshot (read-only)', verdict: v.verdict, note: v.note, round: v.round, source: `audit/${v.source}` }
          : { status: 'pending', method: 'figma get_screenshot', verdict: null, note: null };
      })(),
    };
  })
  .sort((a, b) => Math.abs(b.observed.tracking) - Math.abs(a.observed.tracking));

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'out/inventory.json',
  note: 'FAIL 은 수정 확정이 아니라 강한 검토 대상(high-priority inspection)이다. confirmed-error 와 다르다.',
  verdictsFrom: 'audit/*.json — 사람이 내린 판단. 이 파일은 재생성물이므로 verdict 원본은 audit/ 에 있다.',
  schema: {
    observed: '인벤토리 데이터에 있는 값. 사실.',
    inferred: '크기·문구로 추정한 것. confidence 를 같이 본다. 사실이 아니다.',
    verification: '실물 확인 결과. 확인 전까지 pending.',
  },
  total: rows.length,
  rows,
};
await writeFile('out/tracking-fail-candidates.json', JSON.stringify(out, null, 2), 'utf8');

// ── 요약 ──
const g = (fn) => rows.reduce((m, r) => ((m[fn(r)] = (m[fn(r)] || 0) + 1), m), {});
const show = (t, o) => console.log('\n[' + t + ']\n' + Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`).join('\n'));
console.log('FAIL 후보', rows.length, '건 → out/tracking-fail-candidates.json');
show('관찰 — 자간 구간', g((r) => r.observed.bucket));
show('관찰 — 문자 구성', g((r) => r.observed.scriptType));
show('관찰 — 크기대', g((r) => { const s = r.observed.fontSize; return s === null ? '없음' : s >= 60 ? '60px+' : s >= 40 ? '40–59' : s >= 28 ? '28–39' : s >= 19 ? '19–27' : '≤18'; }));
show('추정 — 역할 (사실 아님)', g((r) => `${r.inferred.role}  [${r.inferred.confidence}]`));
