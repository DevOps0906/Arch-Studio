# UX — 3D 모델러 격차(Motion Studio 대비·PRD 대비)

## 2026-11-02 — 조사(scout 보고, 팀장 기록)

- Motion Studio 정본: `D:\WorkSpace\DEV\Motion-Studio`(HEAD 4ba5dee, 2026-11-01). `motion-studio`는 같은 폴더(대소문자 무시).
- Motion 스택: next 16 · react 19 · three ^0.180 · R3F 9 · drei 10. 기하 커널·상태·실행취소 라이브러리 없음. **LICENSE 없음**.
- Motion 3D는 `app/architecture/viewer/ArchitecturalViewer.tsx`(244줄) **뷰어 1개**: OrbitControls(극각 제한)·Grid·Bounds 자동 맞춤·층 라벨(Text)·조명 4종+그림자·재질 프리셋 3·하드코딩 데모 건물(m float)·GLB 업로드 미리보기(층별 표시·분해도). 조작 기즈모·스냅·선택·단면·측정·실행취소·직접 편집·압출 없음. `docs/architecture/3d/*.md`는 명세 초안만.
- Arch 현재(three 0.186.1·R3F 9.8.2·drei 10.7.9): `modeler/state/commands.ts` addMass(직사각형·다각형)·moveMass·층수·층고·용도·기준 높이·지붕(flat/gable/hip/shed)·삭제·snapMm, 실행취소 100(`state/history.ts`), Viewport SNAP_MM=100·드래그 이동·그리기 미리보기, panels(Toolbar·Inspector·LayerPanel·StatusBar), 워커 메시·엔벨로프 초과 판정(MAX_TRIANGLES 40만), 캡처, 매스 제안.

| 기능 | Motion | Arch 현재 | PRD(AR-F-002·003) | 가져올 가치 |
|---|---|---|---|---|
| 매스 생성·이동·압출·스냅·실행취소 | 없음 | 있음 | 필수 | 없음 |
| 코어·발코니 | 없음 | **없음(명령 미확인)** | 필수 | — (Arch 자체 구현 필요) |
| 단면·측정 | 없음 | 도구 버튼만(미구현 추정) | 화면 명세 | — |
| 조명·그림자·재질 프리셋 | 있음 | 제한적 | 표시용 | 중간(패턴만) |
| 층 라벨·층 숨김·분해도 | 있음 | 미확인 | 범위 밖(표시 보조) | 낮음~중간(UX 패턴) |
| GLB 업로드 뷰어 | 있음 | 없음 | 범위 밖(.3dm 가져오기는 039) | 낮음 |
| 실기 GPU 60fps | — | 소프트웨어 GL만 측정(036) | 필수 | 실측 필요 |

- 재사용 방식: 코드 이식·공용 패키지화는 하지 않고 표시 패턴(조명·재질·Bounds 맞춤·층 라벨·분해도)만 참고. 이유: Motion은 m float·하드코딩 수치라 Arch 정수 mm 결정성과 맞지 않음, LICENSE 없음(이식하려면 소유자 명시 필요). LLM 좌표 충돌 없음.
- 다음 작업 제안(모델러 보강): ① 코어·발코니(PRD 필수) ② 단면·측정 도구 ③ 표시 품질(조명·그림자·재질 프리셋·층 라벨·층 숨김/분해도) ④ 실기 GPU fps 측정(사람). 통합 작업공간 시안(UX-workspace-redesign) 확정 뒤 03장 갱신 → 구현.
