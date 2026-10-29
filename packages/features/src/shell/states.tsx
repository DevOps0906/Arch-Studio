// 화면 공용 상태(03장 5장: 빈·로딩·오류·잠금)와 페이지 머리. packages/ui(EmptyState·Skeleton·Banner·Button)를 조합만 한다.
// 색·크기는 토큰 유틸리티만(hex·px 금지). 상태색은 항상 아이콘 + 글자와 함께(DESIGN.md 6장).
import { Banner, Button, EmptyState, Icon, Skeleton, Spinner } from "@arch-studio/ui";
import type { EntitlementFeature } from "@arch-studio/shell-bridge";
import { useId, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useEntitlement } from "./context.tsx";
import { DENY_TEXT } from "./nav.ts";

/** 화면 머리: 제목 1개 + 주 행동 1개(DASHBOARD_PATTERNS A "페이지 제목과 주 행동 버튼 1개"). */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-h1 font-semibold text-fg">{title}</h1>
        {description ? <p className="text-body text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** 로딩: 스켈레톤 + 스크린리더 문구. 시간 기반 가짜 진행률 금지(5.1절) — 진행률이 있으면 ui Progress를 쓴다. */
export function LoadingState({ label = "불러오는 중", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-gap">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex items-center gap-2 text-caption text-fg-2">
        <Spinner />
        {label}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-row w-full" />
      ))}
    </div>
  );
}

/** 전체 화면 로딩(라우트 가드·세션 복구). */
export function FullScreenLoading({ label = "Arch Studio를 여는 중" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center gap-2 bg-bg text-body text-fg-2">
      <Spinner />
      {label}
    </div>
  );
}

/** 오류: 원인 + 다음 행동. 문구는 03장 5.2·5.3절 또는 errorMessageFor(007)·bridgeErrorText. */
export function ErrorState({ title, description, onRetry, action }: { title: string; description?: ReactNode; onRetry?: () => void; action?: ReactNode }) {
  return (
    <Banner
      tone="danger"
      title={title}
      action={
        action ??
        (onRetry ? (
          <Button size="sm" onClick={onRetry}>
            다시 시도
          </Button>
        ) : undefined)
      }
    >
      {description}
    </Banner>
  );
}

/** 빈 상태(5.4절 문구). ui EmptyState 그대로. */
export const EmptyBlock = EmptyState;

/**
 * 플랜·라이선스 잠금(5.1절 "잠금 아이콘 + 이유 + 다음 행동"). 메뉴를 숨기지 않고 화면 안에서 이유를 보인다(1절 :37).
 * 설치형은 041·074 연결 전까지 대부분 `unverified`로 잠긴다(useEntitlement 주석).
 */
export function LockedState({ title, reason, action }: { title: string; reason: string; action?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col items-start gap-2 rounded-panel border border-line bg-surface p-pad">
      <p id={id} className="flex items-center gap-2 text-h2 font-semibold text-fg">
        <Icon name="lock" className="size-5 text-fg-2" />
        {title}
      </p>
      <p className="text-body text-fg-2">{reason}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </section>
  );
}

export type PreviewState = "ready" | "empty" | "loading" | "error";

/**
 * 자리표시자·스크린샷용 상태 미리보기: `?state=loading|error|empty`. 실제 화면은 데이터 상태로 정하고 이 훅을 지운다.
 */
export function usePreviewState(fallback: PreviewState = "empty"): PreviewState {
  const [params] = useSearchParams();
  const s = params.get("state");
  return s === "loading" || s === "error" || s === "empty" || s === "ready" ? s : fallback;
}

export interface PlaceholderSpec {
  /** 화면 제목(03장 1.1절 이름). */
  readonly title: string;
  /** 명세 위치, 예: "03장 3.5절". */
  readonly spec: string;
  /** 이 폴더를 채울 작업, 예: "AR-06-036". */
  readonly owner: string;
  /** 5.4절 빈 상태 문구(없으면 일반 문구). */
  readonly empty?: { readonly title: string; readonly description?: string };
  readonly loadingLabel?: string;
  readonly errorTitle?: string;
  /** 이 권리가 거부되면 잠금 안내(5.1절)를 먼저 보인다. */
  readonly feature?: EntitlementFeature;
  /** 잠금 제목(5.1절 문구). */
  readonly lockTitle?: string;
}

/** 기능 작업 전 자리표시자. 제목 + 상태 3종 골격(빈·로딩·오류) + 권리 잠금. 각 기능 작업이 자기 폴더에서 바꾼다. */
export function PlaceholderScreen({ title, spec, owner, empty, loadingLabel, errorTitle, feature, lockTitle }: PlaceholderSpec) {
  const state = usePreviewState("empty");
  const decision = useEntitlement(feature);
  return (
    <div className="flex flex-col gap-gap">
      <PageHeader title={title} description={`명세: ${spec} · 구현: ${owner} (자리표시자)`} />
      {decision && !decision.allowed ? (
        <LockedState
          title={lockTitle ?? `${title}은(는) 지금 쓸 수 없습니다`}
          reason={`${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 라이선스 화면에서 상태를 확인하세요.`}
          action={
            <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
              라이선스 보기
            </Link>
          }
        />
      ) : state === "loading" ? (
        <LoadingState label={loadingLabel ?? `${title} 불러오는 중`} />
      ) : state === "error" ? (
        <ErrorState title={errorTitle ?? `${title}을(를) 불러오지 못했습니다`} description="잠시 뒤 다시 시도하세요." onRetry={() => undefined} />
      ) : (
        <EmptyBlock icon="inbox" title={empty?.title ?? "아직 준비 중인 화면입니다"} description={empty?.description ?? `${spec} 명세대로 ${owner}에서 구현합니다.`} />
      )}
    </div>
  );
}
