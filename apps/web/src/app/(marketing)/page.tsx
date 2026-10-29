import type { Metadata } from "next";
import Link from "next/link";
import { HeroVisual } from "../../components/hero/HeroVisual.tsx";
import { ContactCta } from "./_components/contact.tsx";
import { CONTAINER, LinkButton, PendingButton, SECTION, SectionHead, Shell } from "./_components/Shell.tsx";

const TITLE = "Arch Studio | 대지에서 법규 판정, 도면까지";
const DESCRIPTION =
  "건폐율·용적률·정북 일조사선·주차·이격을 근거 조항과 함께 보여 주고, 기획설계 검토용 배치도·면적 산정도를 DXF로 내보내는 소형 건축사사무소용 설계실무 도구입니다.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, locale: "ko_KR", type: "website" },
};

const PAINS = [
  { id: "p1", text: "계약 전 제안 한 건에 하루 이틀을 씁니다." },
  { id: "p2", text: "협력 사무소 회신을 기다리는 동안 건축주가 다른 업체를 알아봅니다." },
  { id: "p3", text: "법령과 조례 개정 시점이 달라 어느 기준으로 볼지 매번 확인합니다." },
] as const;

const COMPARE = [
  ["법규 확인", "조항을 찾아 직접 계산", "지원 항목을 판정하고 근거 조항을 옆에 표시"],
  ["볼륨", "CAD·모델러에서 사선을 작도", "대지를 불러오면 엔벨로프가 생김"],
  ["매스 변경", "바꿀 때마다 다시 계산", "움직이는 동안 판정이 갱신"],
  ["도면", "검토 결과를 다시 그림", "배치도·면적 산정도를 DXF로 내보내 이어 작업"],
] as const;

const STEPS = [
  { n: "1", title: "대지", text: "대지를 불러오거나 직접 그리면 법규 엔벨로프, 곧 지을 수 있는 최대 볼륨이 생깁니다." },
  { n: "2", title: "법규 판정", text: "매스를 움직이는 동안 건폐율·용적률·높이·일조사선 판정이 바뀌고, 근거 조항과 시행일을 함께 보여 줍니다." },
  { n: "3", title: "도면", text: "기획설계 검토용 배치도·면적 산정도를 DXF로 내보내 쓰시던 CAD에서 이어서 작업하세요." },
] as const;

const SCOPE_YES = [
  "건폐율, 용적률, 높이",
  "정북 일조사선",
  "대지안의 공지·이격",
  "주차대수",
  "내진·제로에너지·지정감리 대상 여부",
] as const;

const SCOPE_NO = [
  "위 목록에 없는 규정(목록은 출시 전에 공개합니다)",
  "인허가 서류의 작성과 제출",
  "건축사의 최종 판단",
] as const;

const FAQ = [
  {
    q: "인허가 도면으로 쓸 수 있나요?",
    a: "아닙니다. 기획설계 검토용 자료이며 인허가 설계도서가 아닙니다. 치수와 면적은 판정 엔진과 같은 값을 쓰고, 최종 확인은 설계자가 합니다.",
  },
  {
    q: "어떤 법규를 판정하나요?",
    a: "지원 항목은 규칙 팩의 법규 수치를 확인한 것부터 공개합니다. 목록에 없는 규정은 판정하지 않으며, 지원하지 않는 항목도 목록에 함께 적습니다.",
  },
  {
    q: "쓰던 CAD에서 열 수 있나요?",
    a: "AutoCAD에서 열 수 있는 DXF로 내보냅니다. 샘플 도면 페이지에서 받아 직접 열어 보세요.",
  },
  {
    q: "어떤 PC에서 쓰나요?",
    a: "설치형(Windows x64)과 웹 스튜디오를 함께 준비 중입니다. 설치형 사양은 내려받기 페이지에 있습니다.",
  },
  {
    q: "가격은 얼마인가요?",
    a: "아직 정해지지 않았습니다. 영구·기간제·구독 세 가지 라이선스의 개념은 가격 페이지에서 볼 수 있습니다.",
  },
  {
    q: "입력한 데이터는 어디로 가나요?",
    a: "도면 생성은 사용자 PC에서 이뤄지며 외부로 보내는 것이 없습니다. AI 기능을 쓸 때 보내는 범위는 개인정보 처리방침 초안에 정리했습니다.",
  },
] as const;

export default function LandingPage() {
  return (
    <Shell>
      <main className="break-keep">
        <section aria-labelledby="hero" className={`${CONTAINER} grid grid-cols-1 items-center gap-10 py-10 xl:grid-cols-2 xl:gap-16 xl:py-16`}>
          <div className="flex flex-col gap-6">
            <p className="text-caption font-semibold text-accent">소형 건축사사무소를 위한 설계실무 도구</p>
            <h1 id="hero" className="text-display font-semibold">
              대지를 불러오면 법규 볼륨이 생기고, 매스를 움직이는 동안 <span className="text-accent">판정</span>이 바뀝니다
            </h1>
            <p className="max-w-2xl text-body text-fg-2">
              건폐율·용적률·정북 일조사선·주차·이격을 근거 조항과 함께 보여 주고, 기획설계 검토용 배치도·면적 산정도를 DXF로 내보냅니다.
            </p>
            <div className="flex flex-col gap-3 md:flex-row">
              <LinkButton href="/download">Windows용 다운로드(x64) · 준비 중</LinkButton>
              <PendingButton>웹에서 바로 시작 · 준비 중</PendingButton>
            </div>
            <p className="text-body">
              <Link href="/samples" className="focus-ring rounded-control text-accent underline underline-offset-4">
                샘플 배치도 DXF 받기
              </Link>
            </p>
          </div>
          <HeroVisual />
        </section>

        <section aria-labelledby="pain" className={SECTION}>
          <SectionHead
            id="pain"
            eyebrow="막히는 지점"
            title="볼륨 검토와 법규 확인을 매번 손으로 다시 하기 때문입니다"
            lead="반복 작도와 법규 검토 시간을 줄여 주는 도구입니다."
          />
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PAINS.map((p) => (
              <li key={p.id} className="rounded-card border border-line bg-surface p-6 text-body text-fg-2">
                {p.text}
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-xl border-collapse text-left text-body">
              <caption className="sr-only">손으로 작도·검토할 때와 Arch Studio를 쓸 때 비교</caption>
              <thead className="bg-raised text-fg-3">
                <tr>
                  <th scope="col" className="p-4 font-semibold">항목</th>
                  <th scope="col" className="p-4 font-semibold">손으로 작도·검토</th>
                  <th scope="col" className="p-4 font-semibold text-accent">Arch Studio</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([k, a, b]) => (
                  <tr key={k} className="border-t border-line">
                    <th scope="row" className="p-4 font-semibold">{k}</th>
                    <td className="p-4 text-fg-2">{a}</td>
                    <td className="p-4 text-fg-2">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="flow" className={SECTION}>
          <SectionHead id="flow" eyebrow="3단계" title="대지에서 법규 판정, 도면까지 한 흐름으로" />
          <ol className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6">
                <p className="text-caption font-semibold text-accent">{s.n}단계</p>
                <h3 className="text-h1 font-semibold">{s.title}</h3>
                <p className="text-body text-fg-2">{s.text}</p>
              </li>
            ))}
          </ol>
          <p role="note" className="max-w-3xl rounded-panel border border-line bg-bg-deep p-4 text-body text-fg-2">
            허가 전에 확인할 항목을 근거 조항과 함께 보여 줍니다. 판정은 설계 검토를 돕는 참고 자료이며, 최종 판단은 건축사와 허가권자가 합니다.
          </p>
        </section>

        <section aria-labelledby="drawing" className={SECTION}>
          <SectionHead
            id="drawing"
            eyebrow="도면"
            title="DXF로 내보내 쓰시던 CAD에서 이어서 작업하세요"
            lead="치수와 면적은 판정 엔진과 같은 값을 씁니다. 최종 확인은 설계자가 합니다. 샘플은 가상 대지로 만든 기획설계 검토용 도면입니다."
          />
          <div>
            <LinkButton href="/samples">샘플 도면 보기</LinkButton>
          </div>
        </section>

        <section aria-labelledby="scope" className={SECTION}>
          <SectionHead
            id="scope"
            eyebrow="지원 범위"
            title="판정하는 것과 하지 않는 것"
            lead="법규 수치는 규칙 팩에서 확인을 마친 항목부터 공개합니다. 아래 구분은 공개 전 계획이며, 확정된 목록은 출시 전에 이 자리에 게시합니다."
          />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-6">
              <h3 className="text-h1 font-semibold">판정 대상으로 준비 중</h3>
              <ul className="mt-3 list-disc pl-5 text-body text-fg-2">
                {SCOPE_YES.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-card border border-line bg-surface p-6">
              <h3 className="text-h1 font-semibold">판정하지 않는 것</h3>
              <ul className="mt-3 list-disc pl-5 text-body text-fg-2">
                {SCOPE_NO.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="preorder" aria-labelledby="preorder-h" className={SECTION}>
          <SectionHead
            id="preorder-h"
            eyebrow="가격과 사전예약"
            title="가격 안내 준비 중"
            lead="영구, 기간제, 구독 세 가지 라이선스를 준비하고 있습니다. 가격이 확정되면 가장 먼저 알려 드립니다."
          />
          <div className="flex flex-col items-start gap-4">
            <ContactCta label="사전예약 문의" />
            <Link href="/pricing" className="focus-ring rounded-control text-accent underline underline-offset-4">
              라이선스 종류 보기
            </Link>
          </div>
        </section>

        <section aria-labelledby="faq" className={SECTION}>
          <SectionHead id="faq" eyebrow="자주 묻는 질문" title="시작 전에 많이 묻는 것" />
          <div className="flex max-w-3xl flex-col gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-card border border-line bg-surface p-4">
                <summary className="focus-ring cursor-pointer rounded-control text-body font-semibold">{f.q}</summary>
                <p className="mt-3 text-body text-fg-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </Shell>
  );
}
