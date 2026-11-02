// `/wiki` 법규 해설 위키(03장 3.13절). 소유: AR-06-055. 전 상태 열람(폴백 포함), 로그인 필수, 0크레딧, 사용자 편집 없음.
// 목록(분류·검색·확인일·"출처 확인 필요") → 페이지(`?page=<slug>`: 본문, 출처 목록과 확인일, 관련 규칙 팩 항목, 개정 이력, 최근 점검일).
// 서버 경로가 아직 없어 실제 모드는 오류 상태로 보인다. 데모 모드만 목업 어댑터(wiki/mock.ts)를 동적 import한다.
import { Badge, Banner, Button, Icon, Input, Spinner, cn } from "@arch-studio/ui";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { isApiError } from "../api-client/index.ts";
import { EmptyBlock, ErrorState, LoadingState, PageHeader, useApi, useDemoMode } from "../shell/index.ts";
import {
  WIKI_CATEGORIES,
  categoryLabel,
  dateOnly,
  httpWikiSource,
  isSlug,
  wikiBlocks,
  type WikiCategory,
  type WikiList,
  type WikiPage,
  type WikiSource,
} from "./model.ts";

type Load<T> = { readonly kind: "loading" } | { readonly kind: "error"; readonly message: string } | { readonly kind: "ready"; readonly data: T };

const NOTE = "법규 해설은 판단 근거가 아니라 학습 자료입니다. 판정은 로컬 규칙 엔진 결과를 따르세요.";

function errorText(e: unknown): string {
  if (isApiError(e) && (e.code === "not_found" || e.httpStatus === 404)) return "위키를 찾지 못했습니다. 서버에 아직 공개된 문서가 없을 수 있습니다.";
  if (isApiError(e)) return e.userMessage;
  if (e instanceof Error && e.message === "not_found") return "문서를 찾지 못했습니다.";
  return "위키를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.";
}

/** 데이터 소스: 데모 모드는 목업(동적 import), 그 밖에는 HTTP. 준비 전 null. */
function useWikiSource(): WikiSource | null {
  const api = useApi();
  const demo = useDemoMode();
  const http = useMemo(() => httpWikiSource(api), [api]);
  const [mock, setMock] = useState<WikiSource | null>(null);
  useEffect(() => {
    if (!demo) return;
    let alive = true;
    void import("./mock.ts").then((m) => alive && setMock(m.mockWikiSource()));
    return () => {
      alive = false;
    };
  }, [demo]);
  return demo ? mock : http;
}

function StaleBadge() {
  return (
    <Badge tone="warn" icon="triangle-alert">
      출처 확인 필요
    </Badge>
  );
}

function PageView({ source, slug, onBack, onOpen }: { source: WikiSource; slug: string; onBack: () => void; onOpen: (slug: string) => void }) {
  const [load, setLoad] = useState<Load<WikiPage>>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ kind: "loading" });
    source.page(slug, ctrl.signal).then(
      (data) => !ctrl.signal.aborted && setLoad({ kind: "ready", data }),
      (e: unknown) => !ctrl.signal.aborted && setLoad({ kind: "error", message: errorText(e) }),
    );
    return () => ctrl.abort();
  }, [source, slug, retry]);

  const back = (
    <Button size="sm" variant="ghost" icon="chevron-right" className="[&>svg]:rotate-180" onClick={onBack}>
      목록으로
    </Button>
  );
  if (load.kind === "loading") return <LoadingState label="문서를 불러오는 중" />;
  if (load.kind === "error") return <ErrorState title="문서를 불러오지 못했습니다" description={load.message} onRetry={() => setRetry((r) => r + 1)} />;
  const p = load.data;
  return (
    <article className="flex flex-col gap-gap">
      <div>{back}</div>
      <header className="flex flex-col gap-1">
        <p className="text-caption text-fg-2">{categoryLabel(p.category)}</p>
        <h2 className="text-h1 font-semibold text-fg">{p.title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-caption text-fg-2">
          <span className="tabular-nums">최근 점검일 {p.checked_at ? dateOnly(p.checked_at) : "기록 없음"}</span>
          {p.stale ? <StaleBadge /> : null}
        </p>
      </header>
      <div className="grid grid-cols-1 gap-gap xl:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad xl:col-span-2">
          {wikiBlocks(p.body_md).map((b, i) =>
            b.kind === "heading" ? (
              <h3 key={i} className="text-h2 font-semibold text-fg">
                {b.text}
              </h3>
            ) : b.kind === "item" ? (
              <p key={i} className="flex gap-2 text-body text-fg">
                <span aria-hidden="true" className="text-fg-3">
                  ·
                </span>
                {b.text}
              </p>
            ) : (
              <p key={i} className="text-body text-fg">
                {b.text}
              </p>
            ),
          )}
        </div>
        <aside className="flex flex-col gap-gap">
          <section aria-labelledby="wiki-sources" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
            <h3 id="wiki-sources" className="text-body font-semibold text-fg">
              출처와 확인일
            </h3>
            {p.sources.length === 0 ? (
              <p className="flex items-center gap-1 text-caption text-warn">
                <Icon name="triangle-alert" className="size-3.5" />
                출처가 없습니다. 이 문서를 근거로 쓰지 마세요.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {p.sources.map((s, i) => (
                  <li key={i} className="flex flex-col text-caption text-fg-2">
                    <span className="flex items-center gap-1 font-medium text-fg">
                      <Icon name="book-open" className="size-3.5" />
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer noopener" className="focus-ring rounded-sm text-info underline">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}
                    </span>
                    <span className="tabular-nums">확인일 {dateOnly(s.checked_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {p.links.length > 0 ? (
            <section aria-labelledby="wiki-links" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
              <h3 id="wiki-links" className="text-body font-semibold text-fg">
                관련 항목
              </h3>
              <ul className="flex flex-col gap-1">
                {p.links.map((l, i) => (
                  <li key={i} className="text-caption text-fg-2">
                    {l.slug ? (
                      <button type="button" className="focus-ring rounded-sm text-info underline" onClick={() => onOpen(l.slug!)}>
                        {l.label}
                      </button>
                    ) : (
                      l.label
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="wiki-revisions" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
            <h3 id="wiki-revisions" className="text-body font-semibold text-fg">
              개정 이력
            </h3>
            {p.revisions.length === 0 ? (
              <p className="text-caption text-fg-2">개정 이력이 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {p.revisions.map((r, i) => (
                  <li key={i} className="text-caption text-fg-2">
                    <span className="tabular-nums text-fg">{dateOnly(r.date)}</span> · {r.sections.join(", ") || "바뀐 절 기록 없음"}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </article>
  );
}

function ListView({ source, onOpen }: { source: WikiSource; onOpen: (slug: string) => void }) {
  const [category, setCategory] = useState<WikiCategory | null>(null);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [load, setLoad] = useState<Load<WikiList>>({ kind: "loading" });
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [retry, setRetry] = useState(0);
  const searchId = useId();

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ kind: "loading" });
    source.list({ category, q, cursor: null }, ctrl.signal).then(
      (data) => !ctrl.signal.aborted && setLoad({ kind: "ready", data }),
      (e: unknown) => !ctrl.signal.aborted && setLoad({ kind: "error", message: errorText(e) }),
    );
    return () => ctrl.abort();
  }, [source, category, q, retry]);

  const loadMore = async (cursor: string): Promise<void> => {
    setMore({ busy: true, error: null });
    try {
      const next = await source.list({ category, q, cursor });
      setLoad((l) => (l.kind === "ready" ? { kind: "ready", data: { items: [...l.data.items, ...next.items], next: next.next } } : l));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: errorText(e) });
    }
  };

  const onSearch = (e: FormEvent): void => {
    e.preventDefault();
    setQ(draft.trim());
  };

  return (
    <div className="flex flex-col gap-gap">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div role="group" aria-label="분류" className="flex flex-wrap gap-2">
          {[{ id: null, label: "전체" } as const, ...WIKI_CATEGORIES].map((c) => (
            <Button key={c.label} size="sm" variant={category === c.id ? "primary" : "secondary"} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label}
            </Button>
          ))}
        </div>
        <form role="search" onSubmit={onSearch} className="flex gap-2">
          <label htmlFor={searchId} className="sr-only">
            위키 검색
          </label>
          <Input id={searchId} value={draft} maxLength={100} placeholder="용어·조례 검색" onChange={(e) => setDraft(e.currentTarget.value)} />
          <Button type="submit">검색</Button>
        </form>
      </div>
      {load.kind === "loading" ? (
        <LoadingState label="위키 목록을 불러오는 중" />
      ) : load.kind === "error" ? (
        <ErrorState title="위키를 불러오지 못했습니다" description={load.message} onRetry={() => setRetry((r) => r + 1)} />
      ) : load.data.items.length === 0 ? (
        <EmptyBlock icon="inbox" title={q || category ? "찾는 문서가 없습니다" : "위키 문서가 없습니다"} description={q || category ? "다른 낱말이나 분류로 찾아보세요." : NOTE} />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
            {load.data.items.map((it) => (
              <li key={it.slug}>
                <button
                  type="button"
                  onClick={() => onOpen(it.slug)}
                  className="focus-ring flex w-full flex-col gap-1 p-pad text-left hover:bg-raised md:flex-row md:items-center md:justify-between"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-caption text-fg-2">{categoryLabel(it.category)}</span>
                    <span className="truncate text-body font-medium text-fg">{it.title}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2 text-caption text-fg-2">
                    {it.stale ? <StaleBadge /> : null}
                    <span className="tabular-nums">확인일 {dateOnly(it.checked_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {load.data.next ? (
            <div className="flex flex-col items-start gap-2">
              <Button loading={more.busy} onClick={() => void loadMore(load.data.next!)}>
                더 보기
              </Button>
              {more.error ? <p className="text-caption text-danger">{more.error}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function Screen() {
  const source = useWikiSource();
  const [params, setParams] = useSearchParams();
  const raw = params.get("page");
  const slug = raw && isSlug(raw) ? raw : null;
  const open = (s: string): void => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set("page", s);
    return next;
  });
  const back = (): void => setParams((p) => {
    const next = new URLSearchParams(p);
    next.delete("page");
    return next;
  });
  return (
    <div className="flex flex-col gap-gap overflow-y-auto">
      <PageHeader title="법규 위키" description="조례별 차이·질의회신 요약·용어 해설. 출처와 확인일을 함께 보여 줍니다(읽기 전용, 0 크레딧)." />
      <Banner tone="info" title="학습 자료입니다" className={cn(slug && "hidden md:flex")}>
        {NOTE}
      </Banner>
      {!source ? (
        <p role="status" className="flex items-center gap-2 text-body text-fg-2">
          <Spinner />
          위키를 준비하는 중
        </p>
      ) : slug ? (
        <PageView source={source} slug={slug} onBack={back} onOpen={open} />
      ) : (
        <ListView source={source} onOpen={open} />
      )}
    </div>
  );
}
