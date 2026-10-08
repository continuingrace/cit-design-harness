/** 검증 샘플 선정 — 값 구간 × fontSize × 문구길이 × 추정역할이 겹치지 않게 고른다.
 *  덤으로 각 노드의 "읽을 수 있는 조상"을 찾아준다.
 *  단독 렌더가 비어 나오는 흰색·투명 텍스트 때문에 프레임 전체(5000px)를 부르면 판독이 안 된다.
 *  그래서 폭·높이가 적당한 가장 가까운 조상을 고른다. */
import { readFile } from 'node:fs/promises';
const keys = JSON.parse(await readFile('files.json', 'utf8'));
const cand = JSON.parse(await readFile('out/tracking-fail-candidates.json', 'utf8')).rows;

const caches = {};
for (const [label, key] of Object.entries(keys)) {
  try { caches[key] = JSON.parse(await readFile(`.cache/${key}.json`, 'utf8')); } catch {}
}
const index = {};
for (const [key, f] of Object.entries(caches)) {
  const m = new Map();
  (function walk(n, anc) { m.set(n.id, { node: n, anc }); for (const c of n.children || []) walk(c, anc.concat(n)); })(f.document || f, []);
  index[key] = m;
}
const W = 1400, H = 900;
function readable(key, id) {
  const e = index[key]?.get(id); if (!e) return null;
  // 가장 가까운 조상부터 올라가며 판독 가능한 크기를 찾는다
  for (const a of [...e.anc].reverse()) {
    const b = a.absoluteBoundingBox; if (!b) continue;
    if (b.width >= 120 && b.width <= W && b.height >= 60 && b.height <= H) return { id: a.id, name: a.name, w: Math.round(b.width), h: Math.round(b.height), type: a.type };
  }
  return null;
}
const sig = (r) => `${r.observed.fontSize >= 60 ? 'L' : r.observed.fontSize >= 40 ? 'M' : r.observed.fontSize >= 25 ? 'S' : 'XS'}|${r.observed.charCount >= 25 ? 'long' : r.observed.charCount >= 9 ? 'mid' : 'short'}|${r.inferred.role}`;

function pick(rows, buckets, perBucket) {
  const out = [], usedSig = new Set(), usedFrame = new Set();
  for (const [label, test] of buckets) {
    const pool = rows.filter(test);
    let n = 0;
    for (const pass of [1, 2]) {           // 1차: 시그니처·프레임 둘 다 새것 / 2차: 완화
      for (const r of pool) {
        if (n >= perBucket) break;
        if (out.includes(r)) continue;
        const s = sig(r);
        if (pass === 1 && (usedSig.has(s) || usedFrame.has(r.observed.frame))) continue;
        usedSig.add(s); usedFrame.add(r.observed.frame);
        out.push(Object.assign(r, { _bucket: label, _sig: s })); n++;
      }
    }
  }
  return out;
}
const t = (r) => r.observed.tracking * 100;
const mode = process.argv[2];
const buckets = mode === 'B'
  ? [['-4%대', (r) => t(r) <= -4 && t(r) > -4.4], ['-4.5%대', (r) => t(r) <= -4.4 && t(r) > -5],
     ['-5%대', (r) => t(r) <= -5 && t(r) > -5.5], ['-5.5~6%', (r) => t(r) <= -5.5 && t(r) > -6.5], ['-7% 이하', (r) => t(r) <= -6.5]]
  : [['+20% 이상', (r) => t(r) >= 20], ['+9~19%', (r) => t(r) >= 9 && t(r) < 20], ['+4~8%', (r) => t(r) >= 4 && t(r) < 9],
     ['+1~3%', (r) => t(r) >= 1 && t(r) < 4], ['+0~1%', (r) => t(r) > 0 && t(r) < 1]];
const per = mode === 'B' ? 3 : 4;

for (const r of pick(cand, buckets, per)) {
  const o = r.observed, k = keys[o.file], a = readable(k, o.nodeId);
  console.log([o.trackingLabel.padStart(7), String(o.fontSize).padStart(4) + 'px', String(o.charCount).padStart(3) + '자',
    r.inferred.role.padEnd(14), k, o.nodeId.padEnd(11),
    (a ? `조상 ${a.id} ${a.w}x${a.h}` : '조상없음').padEnd(26), JSON.stringify(o.text.slice(0, 22))].join(' '));
}
