// 파일 대화상자·디스크 흉내(계약 하네스용). 설치형 모킹(rust-invoke)·메모리 더블·072 웹 구현 테스트가 같은 조작면을 쓴다.
// 웹 구현은 `offerImport`로 받은 이름·크기로 File을 만들어 `<input type=file>` 자리에 넣고, 실제로 내용을 읽을 때 `read`를 부른다.

export interface OfferedFile {
  /** 사용자가 고른 파일 이름(경로 포함 가능). 오류·결과에 나오면 안 된다. */
  readonly name: string;
  /** 디스크상 크기(바이트). 내용은 읽을 때 만든다(상한 초과 파일을 메모리에 만들지 않고 흉내). */
  readonly size: number;
  /** 내용. 없으면 size 길이의 0 바이트. */
  readonly bytes?: Uint8Array;
}

export interface SaveTarget {
  /** 저장 대화상자가 고른 경로(오류·결과에 나오면 안 된다). */
  readonly path: string;
  /** 쓰기 실패 흉내(디스크 공간·권한). */
  readonly failWith?: "AR052";
}

export interface FileFixture {
  /** 다음 열기 대화상자 결과. null = 취소. 기본은 취소. */
  offerImport(file: OfferedFile | null): void;
  /** 다음 저장 대화상자 결과. null = 취소. 기본 경로 `C:/Users/kim/export.<형식>`. */
  setSaveTarget(target: SaveTarget | null): void;
  /** 구현 쪽: 열기 대화상자 결과를 꺼낸다(한 번 쓰면 비워짐). */
  takeImport(): OfferedFile | null;
  /** 구현 쪽: 저장 대화상자 결과를 꺼낸다. */
  takeSaveTarget(format: string): SaveTarget | null;
  /** 구현 쪽: 파일 내용을 실제로 읽는다(읽은 바이트 수를 센다). */
  read(file: OfferedFile): Uint8Array;
  /** 구현 쪽: 파일을 쓴다. */
  write(path: string, data: Uint8Array): void;
  /** 지금까지 읽은 바이트 총합(상한 초과 파일은 0이어야 한다 = 읽기 전 거부). */
  bytesRead(): number;
  /** 쓴 파일(경로 → 내용). */
  readonly written: ReadonlyMap<string, Uint8Array>;
}

export function createFileFixture(): FileFixture {
  let nextImport: OfferedFile | null = null;
  let nextSave: SaveTarget | null | undefined;
  let read = 0;
  const written = new Map<string, Uint8Array>();
  return {
    offerImport(file) {
      nextImport = file;
    },
    setSaveTarget(target) {
      nextSave = target;
    },
    takeImport() {
      const f = nextImport;
      nextImport = null;
      return f;
    },
    takeSaveTarget(format) {
      const t = nextSave === undefined ? { path: `C:/Users/kim/export.${format}` } : nextSave;
      nextSave = undefined;
      return t;
    },
    read(file) {
      const bytes = file.bytes ?? new Uint8Array(file.size);
      read += bytes.byteLength;
      return bytes;
    },
    write(path, data) {
      written.set(path, data.slice());
    },
    bytesRead: () => read,
    written,
  };
}
