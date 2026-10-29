# 모델러 성능 스파이크 (AR-06-036, 버리는 코드)

R3F + Manifold WASM으로 모델러(`/projects/:id/model`)를 만들 때 최소 사양 30fps·권장 사양 60fps(매스 50개·삼각형 20만 개)를 낼 수 있는지 확인한다.
결론과 측정 표는 `tasks/logs/AR-06-036.md`에 있다. 이 폴더는 워크스페이스 밖이다(`pnpm-workspace.yaml`에 없음). 패키지와 앱은 여기를 import하지 않는다.

## 실기 측정 방법 (사람이 직접)

준비물: 측정할 PC(Windows 10/11, Chrome 또는 Edge 최신), Node 22 이상, pnpm 10. 전원 어댑터를 연결하고 다른 무거운 프로그램은 닫는다.

```bash
cd spikes/modeler-perf
pnpm install --ignore-workspace
pnpm build
pnpm preview            # http://localhost:4173 이 열리면 브라우저로 접속
```

1. 페이지 맨 위 `GPU:` 줄에서 렌더러 이름이 실제 그래픽 카드(예: `ANGLE (Intel, Intel(R) UHD Graphics 620 …)`)인지 확인한다. `SwiftShader`나 `Microsoft Basic Render`가 나오면 하드웨어 가속이 꺼진 상태다(브라우저 설정 → 시스템 → "가능한 경우 그래픽 가속 사용" 켜기).
2. **렌더 측정**을 누른다. 장면 2개(S50 = 매스 50개·삼각형 7천, S200k = 매스 50개·삼각형 약 20만) × 구성 5개를 각 8초씩 측정한다(약 3분). 측정 중에는 창을 가리거나 최소화하지 않는다(rAF가 멈춘다).
3. 끝나면 **JSON 복사**를 눌러 결과를 `tasks/logs/AR-06-036.md`의 "실기 측정 기록" 절에 PC 사양(CPU, RAM, GPU, 모니터 주사율, 해상도, 배율)과 함께 붙인다.
4. (선택) **전체 측정**은 지오메트리 벤치(워커, n=30)까지 돌린다. 저사양 PC에서는 수 분 걸린다.

URL 옵션: `?secs=15`(구성당 측정 초), `?presets=S200k`(장면 선택), `?auto=1`(자동 실행).

### 합격 기준과 판정

| 구분 | 장면 | 기준 | 표의 열 |
|---|---|---|---|
| 최소 사양(RAM 8GB, WebGL2) | S200k, 권고 구성 (b) 병합 | 평균 30fps 이상 **그리고** p95 프레임 시간 40ms 이하 | `최소 30` |
| 권장 사양 | S200k, 권고 구성 (b) 병합 | 평균 57fps 이상(60Hz 모니터 vsync 상한 감안) **그리고** p95 20ms 이하 | `권장 60` |

- 판정 대상은 권고 구성 (b) 병합이다. (a) 개별, (c) 인스턴스, (b′) 윤곽선, (b″) 드래그 행은 비교용이다. 드래그 행에서는 불린 왕복 지연(`drag.latency_ms`)도 같이 본다(권장 p95 100ms 이하).
- 모니터가 60Hz보다 빠르면(120/144Hz) fps가 60을 넘을 수 있다. 판정은 위 기준을 그대로 쓴다.
- 최소 사양에서 미달하면 `tasks/logs/AR-06-036.md`의 "지오메트리 단순화 방침"(LOD 단계)을 적용한 뒤 다시 잰다.
- `JS 힙 MB`는 Chrome 계열에서만 나온다. `deviceMemory`는 Chrome이 8로 상한을 두므로 실제 RAM은 직접 적는다.

## 자동 측정 (이 저장소의 CI·에이전트 환경)

```bash
pnpm bench:geom      # Node: WASM 초기화, 엔벨로프, 불린, 드래그 증분, 정수 정규화 비용 → out/geom-node.json
node scripts/bench-build.ts   # 매스 솔리드 만드는 방식별 비용 → out/build-node.json
pnpm bench:undo      # 실행 취소 100단계: 스냅샷 vs 구조 공유 vs 명령 → out/undo-node.json
pnpm bench:transfer  # worker_threads 버퍼 왕복 → out/transfer-node.json
pnpm build && pnpm measure 4 /tmp/shot.png   # 헤드리스 chromium(소프트웨어 GL) 하니스 자동 실행 → out/browser-*.json
pnpm audit           # 번들 크기(gzip)·eval/blob/sharp 점검 → out/audit.json
pnpm licenses        # 전이 의존성 라이선스 → out/licenses.json
```

헤드리스 chromium은 SwiftShader(CPU 소프트웨어 래스터라이저)로 WebGL2를 돌린다. **여기서 나온 fps는 실제 GPU 성능이 아니다.** 구성 간 상대 비교와 CPU 측 비용(드로우콜, `gl.render` CPU 시간, 업로드, 워커 왕복)만 의미가 있다.

## 구성
- `src/geom/scene.ts` 결정적 장면(매스 = 정수 mm 요철 k각형 × 층), `core.ts` Manifold 불린·증분 측정 코어(Node·브라우저 공용), `geom.worker.ts` 모듈 워커(`new URL(…, import.meta.url)`, blob: 없음)
- `src/geom/envelope-input.ts` `packages/rules` buildEnvelope(가짜 팩, 법규 수치 아님)를 상대 경로로 **읽기만** 한다
- `src/render/objects.ts` 렌더 구성 (a)(b)(c)(b′)(b″), 레이캐스팅 벤치
- `vite.config.ts` preview가 데스크톱 CSP를 응답 헤더로 보낸다(위반은 결과 JSON `csp_violations`)
