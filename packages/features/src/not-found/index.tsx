// 없는 경로(셸 소유, AR-06-004b).
import { Link } from "react-router";
import { EmptyBlock, PageHeader } from "../shell/index.ts";

export function Screen() {
  return (
    <div className="flex flex-col gap-gap">
      <PageHeader title="페이지를 찾을 수 없습니다" />
      <EmptyBlock
        icon="inbox"
        title="주소가 바뀌었거나 없는 화면입니다"
        description="왼쪽 메뉴에서 다시 고르세요."
        action={
          <Link to="/projects" className="focus-ring rounded-sm text-body text-info underline">
            프로젝트로 가기
          </Link>
        }
      />
    </div>
  );
}
