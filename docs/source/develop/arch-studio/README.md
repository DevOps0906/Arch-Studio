# arch-studio 개발 묶음 — Arch Studio(가칭)

소규모 건축사사무소와 전원주택 시공사가 대지를 불러오면 법규 엔벨로프(건축 가능 볼륨)가 3D로 생기고, 매스를 움직이는 동안 건폐율·용적률·정북 일조사선·주차·이격이 근거 조항과 함께 실시간 판정되며, 배치도·면적 산정도·일조사선 단면을 DXF·SVG·PDF로 자동으로 그리는 설치형 AI 설계실무 앱(Windows, Tauri)입니다. 판정·도면·매스 제안은 오프라인 0크레딧, AI 렌더·클라우드 법규 검토·제안서 PDF·법규 채팅은 크레딧입니다. 앱은 시리얼 영구 라이선스(기기 2대, 연간 업데이트) 또는 월 구독으로 씁니다.

| 항목 | 내용 |
|---|---|
| 주 사용자 | 1~5인 건축사사무소, 전원주택·모듈러 시공사 |
| 앱 id / DB 스키마(모듈러 번호) | `arch` / `arch`(2400), 이 묶음은 모놀리스(`public`) |
| 개발 작업 수 | 71개(`products/arch-studio/06_AGENT_PLAN.md`, AR-06-001~069 + AR-V2-01·02, 웨이브 W0~W8 + W0-D. 065~069는 2026-10-17 설득형 랜딩, 8장) |
| 이 제품만의 것 | 데스크톱 셸(Rust 코어, 키체인, 로컬 SQLite), 서명 라이선스·업데이터, 도면 엔진(결정적 DXF, 골든 + ezdxf audit CI). 개발서 12~13장 |
| 인증 단계 | Mock 로그인(Stage A, 데스크톱은 개발 빌드만)으로 시작 → G1 후 Google + 이메일(B, 데스크톱은 `archstudio://auth/callback` 딥링크) → G2 후 카카오·네이버(C, P2 선택). [`arch-studio_develop.md`](arch-studio_develop.md) 19장 |
| 기획서 | [`products/arch-studio/`](../../products/arch-studio/) (도면은 `01_PRD.md` 9장, 데스크톱 공통은 [`Tauri/README.md`](../../Tauri/README.md)) |
| 참고 | 개발 전에 2일 도면 스파이크(AR-06-019)와 샘플 DXF 랜딩·인터뷰로 먼저 검증하는 순서를 권합니다(개발서 1.1절). 영구 라이선스 결제·데스크톱 Bearer 세션은 공용 코어 요청(R-A1, R-A6 등)이 먼저 반영되어야 합니다(개발서 8장) |

## 이 폴더의 파일

| 파일 | 내용 |
|---|---|
| [`arch-studio_develop.md`](arch-studio_develop.md) | 개발 방법 안내서. 0장부터 순서대로 따라간다 |
| `setup-arch-studio.sh` / `setup-arch-studio.ps1` | 데스크톱 도구(Rust·Tauri CLI·WebView2)를 확인하고(경고만), 베이스 레포를 복사해 개발 폴더 `D:\WorkSpace\DEV\arch-studio\`를 만들고 아래 묶음을 붙이는 설치 스크립트(Git Bash / PowerShell). 먼저 `--dry-run` / `-DryRun`으로 확인한다 |
| `arch-studio-root/` | 개발 폴더 루트에 붙는 내용(`docs/file` 근거 산출물 26개, `docs/wiki`, `supabase`, `infra`, `.claude/skills/llm-wiki`). 직접 고치지 않고 `../_shared/tools/build_root.py arch-studio`로 다시 만든다 |
| [`../../develop_V2/arch-studio/`](../../develop_V2/arch-studio/arch-studio_develop_v2.md) | 공용모듈 적용판(V2). compliance만 채택(AR-V2-01·02), media·search 보류 |

## 시작하기

```bash
bash /d/WorkSpace/platform/docs/develop/arch-studio/setup-arch-studio.sh --dry-run   # 할 일 확인
bash /d/WorkSpace/platform/docs/develop/arch-studio/setup-arch-studio.sh             # 실제 실행
```

전체 흐름은 저장소 맨 위 [README](../../README.md) 4~5절을 참고한다.
