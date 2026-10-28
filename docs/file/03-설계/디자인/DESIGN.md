# DESIGN.md — arch-studio 디자인 토큰 (초기 템플릿)

> 정답 소스는 코드다: `packages/ui/tokens.css`(Tailwind CSS v4 `@theme`). 이 문서는 코드에서 갱신하고, 다르면 코드가 이긴다.
> 규칙: `docs/file/03-설계/디자인/DESIGN_SYSTEM.md`. 피그마 노드 ID나 외부 파일 링크를 적지 않는다.

## 1. 레퍼런스와 방향
| 항목 | 값 |
|---|---|
| 주 레퍼런스 | (DESIGN_SYSTEM.md 5장에서 선택) |
| 가져올 패턴 | |
| 가져오지 않을 것 | |

## 2. 색 토큰 (라이트 / 다크)
| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--color-surface` | | | |
| `--color-text` | | | |
| `--color-text-muted` | | | |
| `--color-accent` | | | |
| `--color-border` | | | |

출발점: 화면설계서(`docs/file/03-설계/03_SCREENS_UX.md`) 4절 토큰 플랜.

## 3. 서체, 간격, radius, 그림자, 모션
| 토큰 | 값 | 용도 |
|---|---|---|
| `--font-display` | | |
| `--font-body` | | |
| `--radius-control` | | |
| `--spacing-*` | | |

## 4. 밀도와 다크 모드
- 밀도: 컴팩트 / 기본
- 다크 모드 전환 방식: `.dark` 또는 `data-theme` 중 하나
