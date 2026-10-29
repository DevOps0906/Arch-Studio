"""골든 DXF ezdxf 검증(AR-06-021). 엄격 읽기 + recover + Auditor, 오류·수정 0이어야 통과(수정도 실패로 센다).

사용: python scripts/golden/audit.py [DXF 경로 ...]
인자가 없으면 packages/drafting/golden/writer-*/*.dxf 전체. 검사할 파일이 0개여도 실패.
"""
import glob
import os
import sys

import ezdxf
from ezdxf import recover

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EXPECTED_VERSION = "AC1027"


def audit(path: str) -> int:
    ezdxf.readfile(path)  # 구조 오류면 예외
    doc, rec = recover.readfile(path)
    aud = doc.audit()
    errors = list(rec.errors) + list(aud.errors)
    fixes = list(rec.fixes) + list(aud.fixes)
    bad = len(errors) + len(fixes)
    if doc.dxfversion != EXPECTED_VERSION:
        print(f"   ERR version {doc.dxfversion} != {EXPECTED_VERSION}")
        bad += 1
    kinds: dict[str, int] = {}
    for e in doc.modelspace():
        kinds[e.dxftype()] = kinds.get(e.dxftype(), 0) + 1
    rel = os.path.abspath(path)
    if rel.startswith(ROOT + os.sep):
        rel = os.path.relpath(rel, ROOT).replace(os.sep, "/")
    print(f"{rel}: errors={len(errors)} fixes={len(fixes)} entities={dict(sorted(kinds.items()))}")
    for m in errors:
        print("   ERR", m.code, m.message)
    for m in fixes:
        print("   FIX", m.code, m.message)
    return bad


def main() -> int:
    paths = sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, "packages", "drafting", "golden", "writer-*", "*.dxf")))
    if not paths:
        print("검사할 DXF가 없습니다")
        return 1
    bad = 0
    for p in paths:
        try:
            bad += audit(p)
        except Exception as exc:  # 읽기 실패도 오류 1건
            print(f"{p}: 읽기 실패 {type(exc).__name__}: {exc}")
            bad += 1
    print(f"ezdxf {ezdxf.__version__}: 파일 {len(paths)}개, 오류·수정 {bad}건")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
