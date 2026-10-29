// sheet 레인 seq 발급(017 스케줄러: "최신만 유효" — 이미 받은 가장 큰 seq보다 작은 요청은 superseded로 버려진다).
// 워커는 화면이 바뀌어도 살아 있으므로 seq는 화면마다 1부터 다시 시작하면 안 된다. 이 파일의 모듈 전역 카운터 하나를
// sheet 레인을 쓰는 모든 화면(도면 시트·표제란 미리보기)이 같이 쓴다. 시간·난수는 쓰지 않는다.
let counter = 0;

/** 다음 seq(1부터 단조 증가). */
export function nextSheetSeq(): number {
  counter += 1;
  return counter;
}
