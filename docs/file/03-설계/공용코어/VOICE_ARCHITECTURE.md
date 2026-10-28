# 음성 서비스 설계 (음성 대화, 제품 음성 기능, 제공자 이원화)

작성일 2026-10-13. 확정 결정 16의 설계 정본이다. DB는 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/0009_core_voice.sql`, 제공자·단가·라우팅은 `0008_core_ai.sql`(kind `stt`, `tts`)을 따른다. 12개 제품 모두 음성 대화와 제품별 음성 기능을 MVP에 넣는다.

## 1. 구조

```
[브라우저] 마이크 녹음(MediaRecorder) · 재생(오디오 스트림)
      │
      ▼
[Next.js /api/voice/*]  인증, 조직 확인, 크레딧 선차감·정산, 제공자 선택(core.resolve_ai_route, kind stt/tts)
      │  TypeScript 음성 어댑터 packages/core-voice: 하나의 인터페이스, 두 구현
      ├── elevenlabs : ElevenLabs TypeScript 공식 SDK (STT, TTS, 보이스)
      └── oss-voice  : 공용 GPU 음성 서버 (FastAPI, Python)  D:\WorkSpace\DEV\platform-voice\ (제안)
                         ├── /stt  faster-whisper(Whisper) + silero-vad
                         └── /tts  상업 이용 가능한 한국어 오픈소스 TTS
      │
      ▼
음성 대화: 말하기 → STT 텍스트 → /api/ai/chat(AI_ARCHITECTURE.md) → 응답 텍스트 → TTS → 재생
```

## 2. TypeScript 음성 어댑터 계약 (예시)

```ts
type VoiceProvider = 'elevenlabs' | 'oss-voice';

interface SttRequest { audio: Blob | ReadableStream; mime: string; language?: 'ko' | 'en' | 'ja'; feature: string }
interface SttResult  { text: string; segments?: { start: number; end: number; text: string }[]; durationSeconds: number; provider: VoiceProvider; model: string }

interface TtsRequest { text: string; voiceId?: string; language?: 'ko' | 'en' | 'ja'; feature: string; format?: 'mp3' | 'ogg' }
interface TtsResult  { audio: ReadableStream; characters: number; provider: VoiceProvider; model: string }

interface VoiceAdapter {
  stt(req: SttRequest, ctx: { orgId: string; appId: string; userId?: string }): Promise<SttResult>;
  tts(req: TtsRequest, ctx: { orgId: string; appId: string; userId?: string }): Promise<TtsResult>;
}
// 선택: resolveVoiceRoute(org, app, feature, 'stt' | 'tts') → 체인 순서로 시도, 결과는 core.voice_jobs + core.ai_usage에 기록
```

## 3. 제공자 선택과 대체

| 항목 | 규칙 |
|---|---|
| 선택 단위 | 기능별 기본값(제품 seed) + 조직 설정(`set_ai_routing`, owner/admin). 모드 `commercial`, `open_source`, `auto` |
| 자동 모드 기본값(제안) | 품질 우선(낭독, 내레이션, 인사말)은 ElevenLabs 우선이고 제품 기본 모드는 `auto`로 통일한다(2026-10-13 사용자 결정). 대량·저비용(받아쓰기, 강의 녹음, 음성 질문)은 오픈소스 우선. 예외: 업무용 앱(admin-suite erp·sms)은 내부 정보 보호를 위해 `voice_chat` TTS도 오픈소스 우선 |
| 대체 | 실패, 429, 시간 초과, 한도 초과면 체인의 다음 제공자로 넘어가고 `voice_jobs.fallback_from`에 원래 제공자를 남긴다. 국외(ElevenLabs, `cross_border=true`)로의 대체는 조직이 국외 이전에 동의(`ai_org_settings`, `core.set_ai_cross_border_ack`)한 경우에만 한다. 동의가 없으면 체인에서 국외 제공자를 빼고, 오픈소스도 실패하면 대체 없이 실패로 처리한다 |
| 대체 금지 | 같은 목소리로 이어져야 하는 기능(연속 낭독, 오디오북)은 대체하지 않고 실패로 처리한다. 강제 오픈소스 범위는 상용으로 대체하지 않는다 |
| hms | 진료 관련 음성·텍스트는 공용 음성 서버와 ElevenLabs로 보내지 않는다. hms 모놀리스는 모든 AI 종류를 오픈소스로 강제하는 기본 행을 갖고, 전용 제공자 `hms-voice`(hms 전용 음성 서버)만 쓴다. 공용 음성 제공자는 비활성화하며 어떤 경우에도 공용 서버로 대체하지 않는다(사용자 결정 2026-10-13) |

## 4. 오픈소스 음성 서버

| 항목 | 내용 |
|---|---|
| STT | faster-whisper(MIT, Whisper 모델). 모델 크기(large-v3, turbo 등)는 GPU 사양과 지연 목표로 구현 시 확정 |
| 무음 감지 | silero-vad(MIT). 무음 구간 제거, 발화 끝 감지 |
| TTS | 상업 이용이 허용되고 한국어를 지원하는 모델만. 구현 시 라이선스 원문과 품질을 확인해 `core.ai_model_prices.license`에 기록 |
| 금지 | 비상업 라이선스 모델은 유료 서비스에 쓰지 않는다. 예: F5-TTS 공개 가중치(CC-BY-NC), Coqui XTTS(CPML). 워크스페이스의 `flora/f5-tts`는 내부 실험용으로만 쓴다 |
| 인증 | Next.js가 발급한 EdDSA 서명 토큰(`AI_ARCHITECTURE.md` 2절, `scope=voice`, `aud=platform-ai:<app>`)만 받는다. 음성 서버는 공개키(JWKS)로 검증만 하고 공유 비밀키를 갖지 않는다 |
| 배포 | Docker + NVIDIA GPU(NVIDIA Container Toolkit). Windows 개발은 WSL2 + Docker Desktop. 설치 문서 `D:/WorkSpace/platform/docs/develop/_shared/voice/` |
| TTS 후보 | 아래 표. 후보일 뿐이며 채택 전에 라이선스 원문과 한국어 품질을 확인한다 |
| 제한 | 요청당 최대 길이(STT 10분, TTS 5,000자, 제안), 파일 크기 50MB, 조직·사용자 레이트 리밋 |

### 4.1 TTS 후보 표

| 후보 | 라이선스(고문 의견) | 확인 | 메모 |
|---|---|---|---|
| CosyVoice2 | Apache-2.0 | 라이선스 원문 확인 필요 | 한국어 품질 검증 필요 |
| Zonos | Apache-2.0 | 라이선스 원문 확인 필요 | 한국어 지원 범위 확인 필요 |
| MeloTTS | MIT | 라이선스 원문 확인 필요 | 품질이 상대적으로 낮음 |
| Chatterbox-Multilingual | MIT | 라이선스 원문 확인 필요 | 한국어 품질 검증 필요 |

- 코드 라이선스와 모델 가중치 라이선스는 별개일 수 있으므로 각각 확인한다. 둘 다 상업 이용이 허용될 때만 채택하고 결과를 `core.ai_model_prices.license`에 기록한다.
- 한국어 발음, 억양, 숫자·영문 혼용 읽기를 평가 문장 세트로 직접 들어 보고 채택한다.

## 5. ElevenLabs

| 항목 | 내용 |
|---|---|
| 호출 | TypeScript 공식 SDK로 Next.js 서버에서만. API 키 `ELEVENLABS_API_KEY`는 서버 전용 |
| 보이스 | 기본 보이스 목록을 제품별로 정한다. 보이스 클로닝은 본인 음성에 한해 신원 확인 + 동의 절차가 있을 때만(Phase 2 제안). 타인(유명인, 지인)의 목소리 복제는 초상·음성 권리(퍼블리시티권)와 부정경쟁 문제로 법적 위험이 크므로 제공하지 않는다 |
| 약관 | 생성 음성의 상업 이용 조건, 요금, 데이터 보관 정책은 구현 시 ElevenLabs 약관으로 확인한다 |
| 개인정보 | 국외 이전 고지 대상(`ai_providers.cross_border=true`). 조직 동의 없이는 호출하지 않는다 |
| 데이터 보관 | 입력 텍스트·오디오의 보관 기간과 학습 사용 여부, 제로 리텐션(zero-retention) 옵션 제공 여부는 결정 항목이다. 계약·요금제 조건을 ElevenLabs에 확인하고 결과를 개인정보 처리방침에 반영한다 |

## 6. 개인정보와 녹음 보관

| 항목 | 규칙 |
|---|---|
| 고지 | 녹음 시작 전 마이크 사용과 처리 목적을 표시한다. 상용 제공자를 쓰면 국외 이전을 고지한다 |
| 기본 | 녹음 원본은 저장하지 않는다(변환 후 폐기). `voice_jobs.store_audio=false` |
| 저장하는 기능 | 강의 녹음, 음성 방명록처럼 원본이 필요한 기능만 사용자 동의 후 `voice-audio` 버킷에 저장하고 `expires_at`을 둔다(제안 30일, 제품별 결정) |
| 정리 | `core.expire_voice_audio()`(service_role, pg_cron 또는 워커)가 만료 작업을 표시하고 경로를 돌려주면 서버가 Storage API로 삭제한다 |
| 접근 | 녹음은 그 작업의 사용자 본인만 읽는다(Storage 정책). 쓰기·삭제는 service_role만 |
| 동의 기록 | 원본을 저장하는 작업(`store_audio=true`)은 `voice_jobs.consent_at`, `consent_kind`(`self`, `third_party_notice`), `notice_version`이 있어야 DB가 받는다(없으면 23514). 방문자 세션은 `voice_sessions.visitor_key`로 소유를 확인한다 |
| 제3자 목소리 | 강의 녹음처럼 다른 사람의 목소리가 담길 수 있는 기능은 녹음 시작 전에 "녹음됩니다" 고지 화면(고지문 버전 표시, 확인 버튼)을 띄우고 `consent_kind=third_party_notice`로 기록한다. 사용자가 강의자·참석자의 동의 책임을 안내받는다. 고지 문구와 법적 검토는 제품 01_PRD 법/개인정보 절에서 확정한다 |

## 7. 크레딧

| 단위 | 기본 단가(제안, seed) |
|---|---|
| STT | ElevenLabs 3 크레딧/분, 오픈소스 0.5 크레딧/분 |
| TTS | ElevenLabs 5 크레딧/1천 자, 오픈소스 1 크레딧/1천 자 |

사용량은 `core.voice_jobs`(작업 단위)와 `core.ai_usage`(kind stt/tts, audio_seconds, characters)에 남기고 `consume_credits`로 확정한다.

## 8. 화면 공통 요소
- 채팅 위젯의 마이크 버튼(누르고 말하기 / 토글), 녹음 중 표시와 남은 시간, 변환 텍스트 미리보기와 수정 후 전송.
- 응답 읽어 주기 버튼과 자동 재생 설정(기본 꺼짐), 재생 속도.
- 마이크 권한 거부, 지원하지 않는 브라우저, 네트워크 오류 안내.
- 접근성: 음성 기능은 텍스트 입력의 대안이다. 모든 기능은 음성 없이도 쓸 수 있어야 한다.
