"use client";

import { Tabs } from "@arch-studio/ui";

const steps = [
  {
    id: "trial",
    label: "체험",
    title: "먼저 설계 흐름을 경험합니다",
    office: "사무소가 하는 일",
    officeDetail: "샘플 대지로 모델과 판정 흐름을 살펴보고, 실제 업무에 적용할 범위를 정합니다.",
    product: "Arch Studio가 하는 일",
    productDetail: "14일 체험과 시작 크레딧을 제공합니다. 체험이 끝난 뒤에도 프로젝트 열람과 기존 도면 내보내기는 유지됩니다.",
  },
  {
    id: "license",
    label: "영구 라이선스",
    title: "설치형을 계속 사용하고 웹 이용 범위를 확인합니다",
    office: "사무소가 하는 일",
    officeDetail: "설치형 라이선스와 웹 이용 기간, 업데이트 조건을 확인한 뒤 구매를 결정합니다.",
    product: "Arch Studio가 하는 일",
    productDetail: "설치형 영구 사용을 제공하고, 웹 스튜디오와 새 규칙 업데이트는 유효한 업데이트 기간에 제공합니다.",
  },
  {
    id: "updates",
    label: "업데이트·크레딧",
    title: "필요한 업데이트와 AI 작업을 이어갑니다",
    office: "사무소가 하는 일",
    officeDetail: "법규 업데이트가 필요할 때 연간 업데이트를 선택하고, AI·클라우드 작업에 필요한 크레딧을 확인합니다.",
    product: "Arch Studio가 하는 일",
    productDetail: "업데이트 기간에는 새 규칙 팩을 제공하고, 실행 전 작업별 크레딧 비용을 안내합니다. 판정과 도면 출력은 크레딧을 쓰지 않습니다.",
  },
] as const;

export function AdoptionSteps() {
  return (
    <section aria-labelledby="adoption-steps-title" className="flex flex-col gap-gap">
      <div>
        <h2 id="adoption-steps-title" className="text-h1 font-semibold">도입 단계</h2>
        <p className="mt-2 text-body text-fg-2">체험부터 필요한 업데이트와 AI 작업까지, 사무소 상황에 맞춰 선택할 수 있습니다.</p>
      </div>
      <Tabs
        label="도입 단계"
        items={steps.map((step) => ({
          id: step.id,
          label: step.label,
          content: (
            <div className="flex flex-col gap-4 py-3">
              <h3 className="text-h2 font-semibold">{step.title}</h3>
              <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-card border border-line bg-surface p-pad">
                  <dt className="text-caption font-semibold text-fg-3">{step.office}</dt>
                  <dd className="mt-2 text-body text-fg-2">{step.officeDetail}</dd>
                </div>
                <div className="rounded-card border border-line bg-surface p-pad">
                  <dt className="text-caption font-semibold text-fg-3">{step.product}</dt>
                  <dd className="mt-2 text-body text-fg-2">{step.productDetail}</dd>
                </div>
              </dl>
            </div>
          ),
        }))}
      />
    </section>
  );
}
