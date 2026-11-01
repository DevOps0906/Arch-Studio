// 지도 타일 인증 상태(순수, 시계 주입): MapLibre transformRequest는 동기라 토큰을 미리 받아 두고, 일정 시간마다·401 뒤에 현재 세션 토큰으로 바꾼다.
// 창을 오래 열어 JWT가 만료돼도 다음 요청부터 새 토큰을 쓴다. 401이 이어지거나 403(권한·권리 없음)이면 배경만 포기한다(대지 폴리곤은 유지).
// 404(범위 밖 타일)·기타 오류는 그 타일만 빈다(무시).

/** 토큰을 다시 받는 간격(ms). 세션 토큰 수명(분 단위)보다 충분히 짧게. */
export const TILE_TOKEN_REFRESH_MS = 60_000;
/** 토큰을 새로 받은 뒤에도 401이 이만큼 이어지면(토큰 세대 기준) 배경을 포기한다. */
export const TILE_AUTH_MAX_FAILURES = 2;

export type TileErrorAction = "refresh" | "give-up" | "ignore";

export interface TileAuth {
  /** transformRequest용 머리글(토큰이 없으면 undefined). url을 주면 그 요청이 쓴 토큰 세대를 기억한다(401 판정용). */
  headers(url?: string): Record<string, string> | undefined;
  /** 다시 받을 때가 됐는가(진행 중이면 false). */
  due(now: number): boolean;
  /** 현재 세션 토큰을 다시 받는다. 같은 때 여러 번 불러도 한 번만 받는다. */
  refresh(now: number): Promise<string | null>;
  /** 타일 오류 HTTP 상태(+요청 URL) → 할 일. 갱신 전 토큰으로 보낸 요청의 401은 이미 갱신했으므로 세지 않는다. */
  onError(status: number | undefined, url?: string): TileErrorAction;
  /** 타일이 정상으로 오면 401 연속 횟수를 지운다. */
  onOk(): void;
}

export function createTileAuth(token: () => Promise<string | null>, refreshMs = TILE_TOKEN_REFRESH_MS, maxFailures = TILE_AUTH_MAX_FAILURES): TileAuth {
  let current: string | null = null;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<string | null> | null = null;
  let unauthorized = 0;
  let gaveUp = false;
  /** 토큰 세대: 같은 토큰으로 동시에 실패한 타일 여러 장은 401 한 번으로 센다. */
  let generation = 0;
  let countedGeneration = -1;
  /** 요청 URL → 보낼 때의 토큰 세대(오류가 오면 지운다). */
  const sentWith = new Map<string, number>();
  return {
    headers(url) {
      if (!current) return undefined;
      if (url) sentWith.set(url, generation);
      return { Authorization: `Bearer ${current}` };
    },
    due: (now) => pending === null && now - fetchedAt >= refreshMs,
    refresh(now) {
      if (pending) return pending;
      // 받기 실패(예외·null)면 이전 토큰을 그대로 쓴다(세대도 그대로).
      pending = token()
        .catch(() => null)
        .then((t) => {
          fetchedAt = now;
          if (t) {
            current = t;
            generation += 1;
          }
          pending = null;
          return current;
        });
      return pending;
    },
    onError(status, url) {
      const sentGeneration = url !== undefined ? sentWith.get(url) : undefined;
      if (url !== undefined) sentWith.delete(url);
      if (gaveUp) return "ignore";
      if (status === 403) {
        gaveUp = true;
        return "give-up";
      }
      if (status !== 401 || countedGeneration === generation) return "ignore";
      if (sentGeneration !== undefined && sentGeneration < generation) return "ignore";
      countedGeneration = generation;
      unauthorized += 1;
      if (unauthorized > maxFailures) {
        gaveUp = true;
        return "give-up";
      }
      return "refresh";
    },
    onOk() {
      unauthorized = 0;
    },
  };
}
