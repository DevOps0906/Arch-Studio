import { LinkButton } from "./Shell.tsx";

/**
 * 사전예약·알림 문의 채널. 아직 정해지지 않았다([확정 필요]: 문의 메일 주소 또는 접수 폼).
 * null 이면 "준비 중" 상태를 보여 주고, 문자열이 들어오면 메일 링크로 바뀐다.
 */
export const CONTACT_EMAIL: string | null = null;

export function ContactCta({ label }: { label: string }) {
  if (CONTACT_EMAIL === null) {
    return (
      <p role="status" className="rounded-panel border border-line bg-surface p-4 text-body text-fg-2">
        {label} 채널을 준비하고 있습니다. 열리는 대로 이 자리에 안내합니다.
      </p>
    );
  }
  return <LinkButton href={`mailto:${CONTACT_EMAIL}`}>{label}</LinkButton>;
}
