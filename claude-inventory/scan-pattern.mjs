/** 조판 패턴 실태 조사 — .cache 를 훑어 특정 조판 모양의 텍스트 노드를 전부 찾는다.
 *  자간으로 찾지 않는다. 자간은 결과로 관찰할 뿐이다.
 *  읽기 전용. Figma 를 호출하지 않는다. */
import { readFile } from 'node:fs/promises';
const keys = JSON.parse(await readFile('files.json', 'utf8'));
const spec = JSON.parse(await readFile('spec.json', 'utf8'));

const WRAP = /^\s*[·•∙・]\s*\S[\s\S]*\S\s*[·•∙・]\s*$/;   // 양끝을 가운뎃점으로 감싼 문구
const hits = [];
for (const [label, key] of Object.entries(keys)) {
  if (spec.excludeFiles?.[label]) continue;
  let f; try { f = JSON.parse(await readFile(`.cache/${key}.json`, 'utf8')); } catch { continue; }
  for (const page of f.document.children || []) {
    for (const art of page.children || []) {
      const ob = art.absoluteBoundingBox;
      (function walk(n) {
        if (n.type === 'TEXT' && WRAP.test(n.characters || '')) {
          const s = n.style || {}, b = n.absoluteBoundingBox;
          hits.push({ file: label, page: page.name, frame: art.name, id: n.id,
            size: s.fontSize ?? null, weight: s.fontWeight ?? null,
            ls: s.letterSpacing ?? 0, align: s.textAlignHorizontal ?? null,
            ratio: s.fontSize ? +(s.letterSpacing / s.fontSize).toFixed(4) : null,
            x: b && ob ? Math.round(b.x - ob.x) : null, y: b && ob ? Math.round(b.y - ob.y) : null,
            w: b ? Math.round(b.width) : null, artW: ob ? Math.round(ob.width) : null,
            chars: n.characters, len: (n.characters || '').trim().length });
        }
        for (const c of n.children || []) walk(c);
      })(art);
    }
  }
}
console.log('· 로 양끝을 감싼 텍스트 노드:', hits.length, '건\n');
const g = (fn) => hits.reduce((m, h) => ((m[fn(h)] = (m[fn(h)] || 0) + 1), m), {});
const show = (t, o) => console.log(`[${t}] ` + Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}×${n}`).join('  '));
show('자간', g(h => h.ratio === null ? '?' : (h.ratio*100).toFixed(1)+'%'));
show('크기', g(h => h.size + 'px'));
show('정렬', g(h => h.align));
show('웨이트', g(h => h.weight));
show('문구 길이', g(h => h.len <= 10 ? '≤10자' : h.len <= 20 ? '11–20자' : '21자+'));
show('파일', g(h => h.file));
console.log();
for (const h of hits) console.log(' ', ((h.ratio*100).toFixed(1)+'%').padStart(7), (h.size+'px').padStart(6), h.align.padEnd(7),
  `가로중앙 ${h.artW && h.w ? (Math.abs((h.x + h.w/2) - h.artW/2) <= 2 ? 'O' : 'X') : '?'}`,
  h.id.padEnd(11), (h.page + ' / ' + h.frame).slice(0, 44).padEnd(46), JSON.stringify(h.chars.slice(0, 30)));
