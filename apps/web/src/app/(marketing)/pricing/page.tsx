import type { Metadata } from "next";
import { Banner } from "@arch-studio/ui";
import { ContactCta } from "../_components/contact.tsx";
import { CONTAINER, LinkButton, SECTION, SectionHead, Shell } from "../_components/Shell.tsx";

const TITLE = "가격 | Arch Studio";
const DESCRIPTION = "Arch Studio 라이선스 종류(영구·기간제·구독)의 개념을 안내합니다. 가격은 아직 정해지지 않아 안내를 준비 중입니다.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, locale: "ko_KR", type: "website" },
};

// 가격 자리표시자: 금액은 모두 비워 둔다. 기간제 가격은 열린 결정이다. 확정되면 PRICE_NOTE 자리에 가격을 넣는다.
const PRICE_NOTE = "가격 안내 준비 중";

const PLANS = [
  {
    id: "perpetual",
    name: "영구 라이선스",
    summary: "한 번 결제하고 설치형을 계속 쓰는 방식입니다.",
    facts: [
      ["결제", "일시불"],
      ["범위", "영구 = 설치형 영구 사용, 웹은 업데이트 기간 동안"],
      ["설치형", "사용자당 PC 2대(기획 기준). 권리는 30일마다 온라인으로 다시 확인하며, 넘기면 재연결 전까지 열람·내보내기만 가능"],
      ["만료 후", "설치형은 마지막 자격 버전을 계속 쓰고, 웹은 열람·내보내기만 가능"],
    ],
  },
  {
    id: "term",
    name: "기간제 라이선스",
    summary: "정한 기간 동안 쓰는 방식입니다. 기간 종류와 가격은 정해지지 않았습니다.",
    facts: [
      ["결제", "선결제, 자동결제 없음"],
      ["설치형·웹", "기간 중 사용"],
      ["만료 후", "열람·내보내기만 가능"],
    ],
  },
  {
    id: "subscription",
    name: "구독",
    summary: "구독하는 동안 쓰는 방식입니다. 결제 주기와 가격은 정해지지 않았습니다.",
    facts: [
      ["결제", "자동결제"],
      ["설치형·웹", "구독 중 사용"],
      ["만료 후", "열람·내보내기만 가능"],
    ],
  },
] as const;

export default function PricingPage() {
  return (
    <Shell>
      <main className="break-keep">
        <div className={`${CONTAINER} flex flex-col gap-4 pt-10 xl:pt-16`}>
          <h1 className="text-display font-semibold">라이선스와 가격</h1>
          <p className="max-w-3xl text-body text-fg-2">
            라이선스는 영구, 기간제, 구독 세 가지로 나뉩니다. 가격은 아직 정해지지 않았고, 확정되면 이 페이지에 먼저 게시합니다.
          </p>
          <Banner tone="info" title={PRICE_NOTE}>
            금액과 사전예약 조건은 확정 전입니다. 사전예약 문의를 남기시면 확정 소식을 먼저 드립니다.
          </Banner>
        </div>

        <section aria-labelledby="plans" className={SECTION}>
          <SectionHead id="plans" title="라이선스 종류" lead="사용자 한 명에게 라이선스 하나가 붙습니다. 설치형과 웹 스튜디오 사용 범위는 종류마다 다릅니다." />
          <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {PLANS.map((p) => (
              <li key={p.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
                <h3 className="text-h1 font-semibold">{p.name}</h3>
                <p className="text-body text-fg-2">{p.summary}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
                  {p.facts.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-fg-3">{k}</dt>
                      <dd className="text-fg-2">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-auto border-t border-line pt-4 text-body font-semibold text-fg">{PRICE_NOTE}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="credits" className={SECTION}>
          <SectionHead
            id="credits"
            title="크레딧"
            lead="AI·클라우드 작업은 라이선스와 별도의 크레딧으로 처리합니다. 도면 생성과 DXF·SVG·PDF 내보내기는 크레딧을 쓰지 않으며 사용자 PC에서 이뤄집니다. 크레딧 단가는 정해지지 않았습니다."
          />
        </section>

        <section id="preorder" aria-labelledby="preorder-h" className={SECTION}>
          <SectionHead id="preorder-h" eyebrow="사전예약" title="사전예약 문의" lead="가격이 확정되면 가장 먼저 알려 드립니다." />
          <div className="flex flex-col items-start gap-4">
            <ContactCta label="사전예약 문의" />
            <LinkButton href="/samples" variant="secondary">
              샘플 도면 먼저 보기
            </LinkButton>
          </div>
        </section>
      </main>
    </Shell>
  );
}
