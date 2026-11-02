// 읽어 주기 버튼: 답변 옆 재생. 한국어 OS 음성이 없으면 렌더하지 않는다(숨김). 자동 재생 없음.
import { Button } from "@arch-studio/ui";
import { useEffect, useMemo, useState } from "react";
import { browserSynth, browserUtterance } from "./browser.ts";
import * as M from "./messages.ts";
import { createSpeaker } from "./speech.ts";

export function ReadAloudButton({ text }: { text: string }) {
  const synth = useMemo(() => browserSynth(), []);
  const speaker = useMemo(() => createSpeaker(synth, browserUtterance), [synth]);
  const [available, setAvailable] = useState(() => speaker.available());
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!synth?.addEventListener) return;
    const update = (): void => setAvailable(speaker.available()); // 음성 목록은 늦게 채워질 수 있다
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener?.("voiceschanged", update);
  }, [synth, speaker]);
  useEffect(() => () => speaker.cancel(), [speaker]);

  if (!available || text.trim() === "") return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={playing}
      onClick={() => {
        if (playing) {
          speaker.cancel();
          setPlaying(false);
          return;
        }
        setPlaying(true);
        speaker.speak(text, () => setPlaying(false));
      }}
    >
      {playing ? M.READ_ALOUD_STOP : M.READ_ALOUD}
    </Button>
  );
}
