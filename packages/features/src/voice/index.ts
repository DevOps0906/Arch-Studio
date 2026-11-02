// 음성 받아쓰기·읽어 주기(AR-06-053). 진입 화면이 아니라 입력 패널·채팅이 가져다 쓰는 부품.
export { VoiceDictation } from "./VoiceDictation.tsx";
export { ReadAloudButton } from "./ReadAloudButton.tsx";
export { createDictation, MAX_RECORD_MS } from "./dictation.ts";
export type { Dictation, DictationDeps, DictationState, RecordingHandle } from "./dictation.ts";
export { createSpeaker, pickKoreanVoice } from "./speech.ts";
export { classifySttError, transcribeAudio } from "./transcribe.ts";
