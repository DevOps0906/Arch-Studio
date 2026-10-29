// 기능 작업 전 자리 표시 화면. 각 경로는 기능 진입점(packages/features/src/<기능>)으로 바뀐다.
export function Placeholder({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
