// AR-06-049 라우팅 대조 파서(의존성 없음). 문서 표와 seed insert 를 같은 모양 { feature, kind, mode, chain, force } 로 만든다.
// 문서: docs/file/03-설계/02_ARCHITECTURE.md "## 5. AI 라우팅" 절의 feature 표(헤더로 찾는다, 줄 번호 금지).
//   - feature 칸의 `a`, `b`, `c` 는 행을 펼친다. `(P2)` 는 지운다.
//   - 체인은 → 로 나눈다. 강제 칸은 "예"/"아니오" 접두만 읽는다(괄호 설명은 무시).
// seed: <schema>.ai_routing_settings insert 의 (null, 'arch', ...) 행.

const DOC_HEADER = /^\|\s*feature\s*\|\s*kind\s*\|\s*모드\s*\|\s*대체 체인\s*\|\s*강제 오픈소스\s*\|/;

export function parseDocTable(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## 5\. AI 라우팅/.test(l));
  if (start < 0) throw new Error('"## 5. AI 라우팅" 절이 없다');
  const rel = lines.slice(start + 1).findIndex((l) => /^## /.test(l));
  const section = rel < 0 ? lines.slice(start + 1) : lines.slice(start + 1, start + 1 + rel);
  const h = section.findIndex((l) => DOC_HEADER.test(l));
  if (h < 0) throw new Error('feature 표 헤더(feature | kind | 모드 | 대체 체인 | 강제 오픈소스)가 없다');
  const rows = [];
  for (const line of section.slice(h + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) throw new Error(`표 칸 수 오류: ${line}`);
    const [featCell, kind, mode, chainCell, forceCell] = cells;
    const features = [...featCell.replace(/\(P2\)/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    if (features.length === 0) throw new Error(`feature 없음: ${line}`);
    const chain = chainCell.split('→').map((s) => s.trim()).filter(Boolean);
    let force;
    if (forceCell.startsWith('예')) force = true;
    else if (forceCell.startsWith('아니오')) force = false;
    else throw new Error(`강제 칸은 "예"/"아니오"로 시작해야 한다: ${forceCell}`);
    for (const feature of features) rows.push({ feature, kind, mode, chain, force });
  }
  return rows;
}

export function parseSeedRows(sql, schema) {
  const head = `insert into ${schema}.ai_routing_settings (org_id, app_id, feature, kind, mode, chain, force_open_source) values`;
  const i = sql.indexOf(head);
  if (i < 0) throw new Error(`${schema}.ai_routing_settings insert 가 없다`);
  const end = sql.indexOf('on conflict', i);
  const block = sql.slice(i + head.length, end);
  const rows = [];
  const re = /\(null, 'arch', '([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'(\[[^']*\])', (true|false)\)/g;
  for (const m of block.matchAll(re)) {
    const items = JSON.parse(m[4]);
    for (const it of items) if (it.model !== '*') throw new Error(`${m[1]}: model '*' 가 아닌 체인 항목`);
    rows.push({ feature: m[1], kind: m[2], mode: m[3], chain: items.map((it) => it.provider), force: m[5] === 'true' });
  }
  const declared = block.split(/\r?\n/).filter((l) => l.trim().startsWith('(')).length;
  if (declared !== rows.length) throw new Error(`seed 행 ${declared}개 중 ${rows.length}개만 읽었다(형식 변경?)`);
  return rows;
}

/** 비교용 정규 문자열(순서 무관 집합 비교). 체인 순서는 보존한다. */
export const rowKey = (r) => `${r.feature}|${r.kind}|${r.mode}|${r.chain.join('>')}|${r.force}`;
