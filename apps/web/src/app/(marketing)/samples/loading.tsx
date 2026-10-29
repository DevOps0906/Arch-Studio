export default function Loading() {
  return (
    <div data-surface="landing" className="min-h-screen bg-bg text-fg">
      <main aria-busy="true" className="mx-auto flex w-full max-w-(--layout-max) flex-col gap-6 px-4 py-10 md:px-8 xl:py-16">
        <p role="status" className="text-body text-fg-2">샘플 도면을 불러오는 중입니다</p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-card border border-line bg-surface" />
          ))}
        </div>
      </main>
    </div>
  );
}
