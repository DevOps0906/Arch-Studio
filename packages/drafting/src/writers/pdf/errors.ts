// 출력 실패(AR056). 사용자 안내 코드는 원래 결과 값으로 돌려주지만(sheet/errors.ts), 파일을 만들지 못한 경우는 돌려줄 결과가 없어 예외로 낸다.
// DraftingErrorCode(sheet/errors.ts, 이 작업 소유 밖)에 출력 실패 코드가 없어 기반 code는 INVALID_ARGUMENT로 두고 user_code로 구분한다
// (후속: sheet 소유자가 "OUTPUT_FAILED"를 추가하면 바꾼다).
import { DraftingError } from "../../sheet/errors.ts";

/** pdf_failed·png_failed = 작성기가 파일을 만들지 못함, font_unavailable = 번들 글꼴·폭 표를 읽지 못하거나 서로 맞지 않음. */
export type OutputFailure = "pdf_failed" | "png_failed" | "font_unavailable" | "png_not_implemented";

export class OutputError extends DraftingError {
  /** 사용자 안내 코드(PRD 오류 표). */
  readonly user_code = "AR056" as const;
  readonly failure: OutputFailure;
  constructor(failure: OutputFailure, message: string, options?: { cause?: unknown }) {
    super("INVALID_ARGUMENT", message);
    this.name = "OutputError";
    this.failure = failure;
    if (options && "cause" in options) (this as { cause?: unknown }).cause = options.cause;
  }
}
