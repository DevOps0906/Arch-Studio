# 제3자 고지 (Third-Party Notices)

배포물(설치 파일·웹 번들)에 포함되는 제3자 코드와 라이선스를 적는다. 새 런타임 의존성을 넣는 작업은 이 파일에 항목을 추가한다
(`secscan license` 확인, GPL·AGPL 거부 — AGENTS.md 3장). 개발 전용 의존성(테스트·빌드 도구)은 배포물에 들어가지 않아 적지 않는다.

## @arch-studio/geometry (AR-06-014)
- 제3자 코드 없음. 2D 다각형 합집합·오프셋·면적·최단거리는 자체 구현이다.
- 검토 후 채택하지 않은 후보: Clipper2 TypeScript 포트 `clipper2-ts@2.0.1`(Boost Software License 1.0, © Angus Johnson·Jeremy Tribby).
  코드를 복사하지 않았다. 오프셋의 구조(오목 꼭짓점 3점 삽입 후 positive 채움으로 정리, miter 한도 기준 `cos > 2/limit² − 1`,
  일직선 기준 `cos > 0.999`)는 Clipper2의 공개된 알고리즘 설명을 참고했다. 근거: `tasks/logs/AR-06-014.md` [DECISION] AR-02-D1.

## @arch-studio/domain
- zod 3.25.76 — MIT License, Copyright (c) Colin McDonnell. https://github.com/colinhacks/zod
