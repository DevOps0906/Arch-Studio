"""ezdxf 검증: 파일을 그대로 읽어(strict) + recover 경로 + Auditor. 오류 0이어야 통과."""
import sys, glob
import ezdxf
from ezdxf import recover

bad = 0
for path in sorted(glob.glob('out/*.dxf')):
    doc_strict = ezdxf.readfile(path)  # 구조 오류면 예외
    doc, rec_auditor = recover.readfile(path)
    aud = doc.audit()
    errs = len(rec_auditor.errors) + len(aud.errors)
    fixes = len(rec_auditor.fixes) + len(aud.fixes)
    msp = doc.modelspace()
    kinds = {}
    for e in msp:
        kinds[e.dxftype()] = kinds.get(e.dxftype(), 0) + 1
    print(f"{path}: version={doc.dxfversion} errors={errs} fixes={fixes} entities={dict(sorted(kinds.items()))}")
    for m in list(rec_auditor.errors) + list(aud.errors):
        print('   ERR', m.code, m.message)
    for m in list(rec_auditor.fixes) + list(aud.fixes):
        print('   FIX', m.code, m.message)
    bad += errs + fixes
sys.exit(1 if bad else 0)
