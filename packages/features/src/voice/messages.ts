// 음성 UI 문구(03장 3.12절·5장). 화면 문구는 한국어.
export const VOICE_NOTICE_TITLE = "음성 받아쓰기 안내";
export const VOICE_NOTICE_BODY =
  "녹음한 음성은 글자로 바꾸기 위해 서버로 보내지며, 원본 녹음과 변환 결과는 서버에 저장하지 않습니다. 한 번에 최대 60초까지 녹음하고 1 크레딧이 쓰입니다. 음성 없이도 모든 기능을 쓸 수 있습니다.";
export const VOICE_NOTICE_ACCEPT = "동의하고 녹음";
export const VOICE_NOTICE_CANCEL = "취소";

export const MIC_DENIED = "마이크를 쓸 수 없습니다. 브라우저 또는 Windows 설정 > 개인정보 > 마이크에서 허용하거나 텍스트로 입력하세요.";
export const MIC_UNSUPPORTED = "이 환경에서는 음성 녹음을 지원하지 않습니다. 텍스트로 입력하세요.";
export const STT_DISABLED = "음성 받아쓰기를 지금은 사용할 수 없습니다. 텍스트로 입력하세요.";
export const STT_REPLAY = "이미 처리된 요청입니다. 결과를 받지 못했다면 다시 녹음해 주세요. 크레딧 1이 사용되었을 수 있습니다.";
export const STT_EMPTY = "녹음된 소리가 없습니다. 다시 녹음하거나 텍스트로 입력하세요.";
export const STT_TOO_LARGE = "녹음이 너무 깁니다. 60초 안으로 나눠서 다시 녹음하세요.";
export const STT_FAILED_REFUNDED = "음성을 글자로 바꾸지 못했습니다. 크레딧은 환불되었습니다. 다시 보내거나 텍스트로 입력하세요.";
export const STT_REFUND_PENDING = "음성을 글자로 바꾸지 못했습니다. 크레딧은 환불 처리됩니다. 다시 녹음하거나 텍스트로 입력하세요.";
export const STT_EMPTY_REFUNDED = "인식된 내용이 없습니다. 크레딧은 환불되었습니다. 다시 녹음하거나 텍스트로 입력하세요.";
export const STT_FAILED = "음성을 글자로 바꾸지 못했습니다. 다시 시도하거나 텍스트로 입력하세요.";

export const RECORD_START = "음성으로 입력";
export const RECORD_STOP = "녹음 끝내기";
export const RECORD_CANCEL = "취소";
export const TRANSCRIBE_CANCEL = "전사 취소";
export const RECORDING = "녹음 중";
export const TRANSCRIBING = "글자로 바꾸는 중";
export const RESULT_LABEL = "받아쓴 내용(수정할 수 있습니다)";
export const RESULT_APPLY = "입력창에 넣기";
export const RESULT_DISCARD = "버리기";
export const RETRY_SEND = "다시 보내기";

export const READ_ALOUD = "읽어 주기";
export const READ_ALOUD_STOP = "읽기 멈춤";
