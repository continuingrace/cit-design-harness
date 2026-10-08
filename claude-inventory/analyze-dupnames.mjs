/** 프레임명 중복 — 구조 분석. 중복을 오류라고 가정하지 않는다.
 *  observed  캐시에서 그대로 읽은 값
 *  inferred  그 값으로 내가 붙인 해석. 사실이 아니다
 *  읽기 전용. Figma 를 호출하지 않는다. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const keys = JSON.parse(await readFile('files.json', 'utf8'));
const spec = JSON.parse(await readFile('spec.json', 'utf8'));
const YY = spec.currentSinceYY;
const sources = [];
for (const [label, key] of Object.entries(keys)) {
  if (spec.excludeFiles?.[label]) continue;
  const doc = JSON.parse(await readFile(`.cache/${key}.json`, 'utf8'));
  if (!Array.isArray(doc?.document?.children)) throw new Error(`잘못된 Figma 캐시 구조: ${label}`);
  sources.push({ label, doc });
}
/** figma-inventory.mjs 의 frameDate/frameYear 와 같은 규칙을 쓴다.
 *  8자리(20260303_)를 먼저 보고, 그다음 6자리(260303_). 순서가 바뀌면 20 년으로 읽힌다. */
const frameDate = (name) => {
  let m = /^(\d{4})(\d{2})(\d{2})_/.exec(name);
  if (m) return m[1].slice(2) + m[2] + m[3];
  m = /^(\d{2})(\d{2})(\d{2})_/.exec(name);
  return m ? m[1] + m[2] + m[3] : null;
};
const yearOf = (n) => { const d = frameDate(n || ''); return d ? Number(d.slice(0, 2)) : null; };

/** 프레임 지문.
 *
 *  1차에는 텍스트만 넣었다가 틀렸다(예시 서사). 텍스트가 전부 같은 프레임 그룹이 있었는데
 *  '복제본' 으로 판정했더니, 실물을 보니 배경색이 다른 A/B 안이었다. 텍스트가 아예 없는
 *  다른 그룹은 이미지가 서로 달랐다.
 *  그래서 텍스트 · 색 · 이미지를 각각 따로 지문화한다. 셋이 다 같아야 같은 것이다.
 */
function fingerprint(node) {
  const t = [], fills = [], imgs = [];
  (function w(n) {
    if (n.type === 'TEXT' && n.characters) t.push(n.characters.trim());
    for (const f of n.fills || []) {
      if (f.visible === false) continue;
      if (f.type === 'SOLID' && f.color) {
        const c = f.color;
        fills.push([c.r, c.g, c.b, f.opacity ?? 1].map((v) => Math.round(v * 255)).join(','));
      }
      if (f.type === 'IMAGE' && f.imageRef) imgs.push(f.imageRef);
      for (const st of f.gradientStops || []) if (st.color) fills.push('g' + Object.values(st.color).map((v) => Math.round(v * 255)).join(','));
    }
    for (const c of n.children || []) w(c);
  })(node);
  const h = (a) => createHash('sha1').update(a.join('\u0000')).digest('hex').slice(0, 10);
  return { hash: h(t), fillHash: h(fills), imageHash: h(imgs),
           textCount: t.length, chars: t.join('').length, fillCount: fills.length, imageCount: imgs.length };
}

const groups = [];
for (const { label, doc: f } of sources) {
  for (const page of f.document.children || []) {
    const idx = new Map();
    for (const a of page.children || []) {
      if (a.type !== 'FRAME' && a.type !== 'COMPONENT') continue;
      if (!idx.has(a.name)) idx.set(a.name, []);
      idx.get(a.name).push(a);
    }
    for (const [name, arr] of idx) {
      if (arr.length < 2) continue;
      const y = yearOf(name);
      if (y === null || y < YY) continue;                       // 현행만
      const nodes = arr.map((a) => { const b = a.absoluteBoundingBox || {};
        return { id: a.id, x: Math.round(b.x ?? 0), y: Math.round(b.y ?? 0),
                 w: Math.round(b.width ?? 0), h: Math.round(b.height ?? 0),
                 children: (a.children || []).length, ...fingerprint(a) }; });

      // ── observed ──
      const sizes = new Set(nodes.map((n) => `${n.w}x${n.h}`));
      const hashes = new Set(nodes.map((n) => n.hash));
      const fillHashes = new Set(nodes.map((n) => n.fillHash));
      const imageHashes = new Set(nodes.map((n) => n.imageHash));
      const fullHashes = new Set(nodes.map((n) => `${n.hash}|${n.fillHash}|${n.imageHash}`));
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const boxes = nodes.map((n) => [n.x, n.y, n.x + n.w, n.y + n.h]);
      let overlap = false;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a1,b1,c1,d1] = boxes[i], [a2,b2,c2,d2] = boxes[j];
        if (a1 < c2 && a2 < c1 && b1 < d2 && b2 < d1) overlap = true;
      }
      const observed = {
        file: label, page: page.name, frameName: name, nodeCount: nodes.length,
        distinctSizes: sizes.size, sizes: [...sizes],
        distinctTextHashes: hashes.size,
        distinctFillHashes: fillHashes.size,
        distinctImageHashes: imageHashes.size,
        distinctFullHashes: fullHashes.size,
        allTextIdentical: hashes.size === 1,
        allIdentical: fullHashes.size === 1 && sizes.size === 1,
        anyEmptyText: nodes.some((n) => n.textCount === 0),
        sameRow: new Set(ys).size === 1, sameColumn: new Set(xs).size === 1,
        overlapping: overlap,
        spanX: Math.max(...xs) - Math.min(...xs), spanY: Math.max(...ys) - Math.min(...ys),
        nodes,
      };

      // ── inferred (사실 아님) ──
      let kind, confidence, basis;
      const diffs = [];
      if (observed.distinctSizes > 1) diffs.push(`규격 ${observed.distinctSizes}종`);
      if (observed.distinctTextHashes > 1) diffs.push(`문구 ${observed.distinctTextHashes}종`);
      if (observed.distinctFillHashes > 1) diffs.push(`색 ${observed.distinctFillHashes}종`);
      if (observed.distinctImageHashes > 1) diffs.push(`이미지 ${observed.distinctImageHashes}종`);

      if (observed.allIdentical) {
        // '완전 동일' 이라 부르지 않는다. 지문이 같다는 것은 지문이 보는 축에서 같다는 뜻일 뿐이다.
        // deep-compare.mjs 가 9개 축을 더 봤고, 24그룹 중 4그룹에서 1~4px 위치 차이가 나왔다.
        kind = 'visual-equivalent candidate (문구·색·이미지·규격 일치)'; confidence = 'medium';
        basis = '세 지문이 일치한다. 시각적으로 같다고 확정한 것이 아니라 후보다 — deep-compare.mjs 참조';
      } else if (observed.distinctFullHashes === nodes.length) {
        kind = `서로 다른 산출물 (${diffs.join(' · ')})`; confidence = 'high';
        basis = `노드 ${nodes.length}개가 전부 서로 다르다`;
      } else {
        kind = `일부 동일 (${diffs.join(' · ')})`; confidence = 'high';
        basis = `노드 ${nodes.length}개 중 서로 다른 조합 ${observed.distinctFullHashes}종`;
      }
      groups.push({ observed, inferred: { kind, confidence, basis } });
    }
  }
}

groups.sort((a, b) => b.observed.nodeCount - a.observed.nodeCount);
await writeFile('out/dupname-analysis.json', JSON.stringify({
  generatedAt: new Date().toISOString(), source: '.cache/*.json',
  files: sources.map(({ label }) => label),
  note: '중복을 오류라고 가정하지 않는다. observed 는 사실, inferred 는 해석이다.',
  groupCount: groups.length, nodeTotal: groups.reduce((s, g) => s + g.observed.nodeCount, 0), groups,
}, null, 2), 'utf8');

const g = (fn) => groups.reduce((m, x) => ((m[fn(x)] = (m[fn(x)] || 0) + 1), m), {});
const show = (t, o) => console.log(`\n[${t}]\n` + Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`  ${String(n).padStart(4)}  ${k}`).join('\n'));
console.log('중복 그룹', groups.length, '· 노드 합계', groups.reduce((s,x)=>s+x.observed.nodeCount,0));
show('inferred — 성격 (해석. 사실 아님)', g((x) => `${x.inferred.kind}  [${x.inferred.confidence}]`));
show('observed — 문구', g((x) => x.observed.distinctTextHashes === 1 ? '전부 같음' : `${x.observed.distinctTextHashes}종`));
show('observed — 색', g((x) => x.observed.distinctFillHashes === 1 ? '전부 같음' : `${x.observed.distinctFillHashes}종`));
show('observed — 이미지', g((x) => x.observed.distinctImageHashes === 1 ? '전부 같음' : `${x.observed.distinctImageHashes}종`));
show('observed — 문구+색+이미지 조합', g((x) => x.observed.distinctFullHashes === 1 ? '전부 같음 (visual-equivalent candidate)' : x.observed.distinctFullHashes === x.observed.nodeCount ? '전부 다름' : `${x.observed.distinctFullHashes}종`));
show('observed — 규격', g((x) => x.observed.distinctSizes === 1 ? '전부 같음' : `${x.observed.distinctSizes}종`));
show('observed — 겹침', g((x) => x.observed.overlapping ? '겹쳐 있음' : '안 겹침'));
