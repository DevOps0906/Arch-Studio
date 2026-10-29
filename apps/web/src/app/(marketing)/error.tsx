"use client";

export default function MarketingError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div data-surface="landing" className="min-h-screen bg-bg text-fg">
      <main className="mx-auto flex w-full max-w-(--layout-max) flex-col gap-4 px-4 py-10 md:px-8 xl:py-16">
        <section role="alert" className="rounded-panel border border-danger bg-surface p-6">
          <h1 className="text-h2 font-semibold text-danger">화면을 불러오지 못했습니다</h1>
          <p className="mt-2 text-body text-fg-2">잠시 뒤 다시 시도해 주세요.</p>
          <button
            type="button"
            onClick={reset}
            className="focus-ring mt-4 inline-flex h-control items-center rounded-control bg-accent-strong px-4 text-body font-semibold text-accent-strong-fg"
          >
            다시 시도
          </button>
        </section>
      </main>
    </div>
  );
}
