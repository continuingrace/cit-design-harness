/** visual-equivalent candidate 그룹의 심층 비교.
 *
 *  현재 지문(문구·색·이미지)이 놓치는 차이가 있는지 본다.
 *  1차에 텍스트만 봤다가 색·이미지 차이를 놓친 전례가 있어서, 이번엔 "안 본 축" 을 먼저 나열하고 전부 센다.
 *  읽기 전용. Figma 를 호출하지 않는다.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const keys = JSON.parse(await readFile('files.json', 'utf8'));
const analysis = JSON.parse(await readFile('out/dupname-analysis.json', 'utf8'));
const targets = analysis.groups.filter((g) => g.observed.allIdentical);
const targetLabels = new Set(targets.map((g) => g.observed.file));
const sources = [];
for (const [label, key] of Object.entries(keys)) {
  if (!targetLabels.has(label)) continue;
  const doc = JSON.parse(await readFile(`.cache/${key}.json`, 'utf8'));
  if (!Array.isArray(doc?.document?.children)) throw new Error(`잘못된 Figma 캐시 구조: ${label}`);
  sources.push({ label, doc });
}
const h = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 10);
const r3 = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);

/** 프레임 하나에서 축별 지문을 뽑는다. 각 축은 따로 비교한다 — 합치면 어디가 다른지 못 본다 */
function axes(frame) {
  const A = { effects: [], strokes: [], opacity: [], radius: [], hidden: [], imageTransform: [], blend: [], structure: [], childPos: [] };
  (function walk(n, path, depth) {
    const tag = `${path}/${n.type}`;
    A.structure.push(`${'  '.repeat(depth)}${n.type}:${n.name || ''}`);
    for (const e of n.effects || [])
      A.effects.push([tag, e.type, e.visible !== false, r3(e.radius), r3(e.spread), e.offset && [r3(e.offset.x), r3(e.offset.y)],
                      e.color && Object.values(e.color).map((v) => Math.round(v * 255))].join('|'));
    for (const st of n.strokes || [])
      A.strokes.push([tag, st.type, st.visible !== false, st.color && Object.values(st.color).map((v) => Math.round(v * 255)),
                      r3(n.strokeWeight), n.strokeAlign, (n.strokeDashes || []).join(',')].join('|'));
    if (n.opacity !== undefined && n.opacity !== 1) A.opacity.push(`${tag}|${r3(n.opacity)}`);
    if (n.blendMode && n.blendMode !== 'PASS_THROUGH' && n.blendMode !== 'NORMAL') A.blend.push(`${tag}|${n.blendMode}`);
    if (n.cornerRadius !== undefined) A.radius.push(`${tag}|${r3(n.cornerRadius)}`);
    if (n.rectangleCornerRadii) A.radius.push(`${tag}|[${n.rectangleCornerRadii.map(r3).join(',')}]`);
    if (n.visible === false) A.hidden.push(tag);
    for (const f of n.fills || []) {
      if (f.type !== 'IMAGE') continue;
      A.imageTransform.push([tag, f.scaleMode, (f.imageTransform || []).flat().map(r3).join(','), r3(f.rotation), r3(f.scalingFactor)].join('|'));
    }
    const b = n.absoluteBoundingBox, fb = frame.absoluteBoundingBox;
    if (b && fb) A.childPos.push(`${tag}|${r3(b.x - fb.x)},${r3(b.y - fb.y)},${r3(b.width)}x${r3(b.height)}`);
    (n.children || []).forEach((c, i) => walk(c, `${path}/${i}`, depth + 1));
  })(frame, '', 0);
  const out = {};
  for (const [k, v] of Object.entries(A)) out[k] = { hash: h(v), count: v.length, sample: v.slice(0, 3) };
  return out;
}

const AXES = ['effects', 'strokes', 'opacity', 'blend', 'radius', 'hidden', 'imageTransform', 'structure', 'childPos'];
const results = [];
for (const { label, doc: f } of sources) {
  const byId = new Map();
  for (const p of f.document.children || []) for (const a of p.children || []) byId.set(a.id, a);
  for (const g of targets) {
    if (g.observed.file !== label) continue;
    const frames = g.observed.nodes.map((n) => byId.get(n.id));
    if (frames.some((frame) => !frame)) throw new Error(`비교 대상 노드가 캐시에 없습니다: ${label} / ${g.observed.frameName}`);
    const per = frames.map(axes);
    const diff = {}, detail = {};
    for (const ax of AXES) {
      const hs = new Set(per.map((p) => p[ax].hash));
      diff[ax] = hs.size > 1;
      if (hs.size > 1) detail[ax] = per.map((p, i) => ({ node: g.observed.nodes[i].id, count: p[ax].count, sample: p[ax].sample }));
    }
    results.push({ frameName: g.observed.frameName, file: label, page: g.observed.page,
      nodeCount: frames.length, nodes: g.observed.nodes.map((n) => n.id),
      differingAxes: AXES.filter((a) => diff[a]), allSame: AXES.every((a) => !diff[a]), detail });
  }
}

await writeFile('out/dupname-deep-compare.json', JSON.stringify({
  generatedAt: new Date().toISOString(), method: '캐시 전수 비교. Figma 호출 없음',
  axesChecked: AXES, groups: results.length, results,
}, null, 2), 'utf8');

console.log('visual-equivalent candidate', results.length, '그룹 심층 비교\n');
const cnt = {}; for (const ax of AXES) cnt[ax] = results.filter((r) => r.differingAxes.includes(ax)).length;
console.log('[축별로 차이가 발견된 그룹 수]');
for (const [k, v] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)} / ${results.length}  ${k}`);
console.log();
const clean = results.filter((r) => r.allSame);
console.log('모든 축 동일:', clean.length, '· 어딘가 다름:', results.length - clean.length);
console.log('\n[차이가 나온 그룹]');
for (const r of results.filter((x) => !x.allSame))
  console.log('  ', String(r.nodeCount) + '개', r.frameName.slice(0, 40).padEnd(42), '→', r.differingAxes.join(' · '));
