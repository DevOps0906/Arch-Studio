"""최소 구조 확정용 제거 실험: 섹션/테이블/객체를 빼고 ezdxf strict·audit 결과를 본다(AutoCAD 동작은 별도)."""
import re, ezdxf
from ezdxf import recover
src = open('out/site1.dxf', encoding='utf8', newline='').read().split('\r\n')
pairs = [(src[i], src[i + 1]) for i in range(0, len(src) - 1, 2)]

def drop_section(name):
    out, skip = [], False
    for i, (c, v) in enumerate(pairs):
        if c.strip() == '0' and v == 'SECTION' and pairs[i + 1][1] == name: skip = True
        if not skip: out.append((c, v))
        if skip and c.strip() == '0' and v == 'ENDSEC': skip = False
    return out
def drop_table(name):
    out, skip = [], False
    for i, (c, v) in enumerate(pairs):
        if c.strip() == '0' and v == 'TABLE' and pairs[i + 1][1] == name: skip = True
        if not skip: out.append((c, v))
        if skip and c.strip() == '0' and v == 'ENDTAB': skip = False
    return out
def drop_obj(types):
    out, skip, inobj = [], False, False
    for i, (c, v) in enumerate(pairs):
        if c.strip() == '0' and v == 'SECTION' and pairs[i + 1][1] == 'OBJECTS': inobj = True
        if inobj and c.strip() == '0': skip = v in types
        if inobj and v == 'ENDSEC' and c.strip() == '0': inobj = False; skip = False
        if not skip: out.append((c, v))
    return out

def check(label, ps):
    open('ablate.tmp.dxf', 'w', encoding='utf8', newline='').write('\r\n'.join(x for p in ps for x in p) + '\r\n')
    try:
        ezdxf.readfile('ablate.tmp.dxf'); strict = 'strict OK'
    except Exception as e:
        strict = f'strict 예외 {type(e).__name__}'
    try:
        doc, a = recover.readfile('ablate.tmp.dxf'); au = doc.audit()
        r = f'errors={len(a.errors)+len(au.errors)} fixes={len(a.fixes)+len(au.fixes)}'
    except Exception as e:
        r = f'recover 예외 {type(e).__name__}'
    print(f'{label:34s} {strict:22s} {r}')

check('기준(전체)', pairs)
for s in ('OBJECTS', 'CLASSES', 'BLOCKS'): check(f'섹션 제거: {s}', drop_section(s))
for t in ('VPORT', 'VIEW', 'UCS', 'DIMSTYLE', 'STYLE', 'APPID', 'LTYPE', 'BLOCK_RECORD'): check(f'테이블 제거: {t}', drop_table(t))
check('LAYOUT 객체 제거', drop_obj({'LAYOUT'}))
check('MLINESTYLE 제거', drop_obj({'MLINESTYLE'}))
check('PLOTSTYLE(WDFLT,PLACEHOLDER) 제거', drop_obj({'ACDBDICTIONARYWDFLT', 'ACDBPLACEHOLDER'}))
