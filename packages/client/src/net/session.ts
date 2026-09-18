/**
 * 재접속용 세션 기억.
 *
 * 프라이빗 모드나 스토리지 차단 환경에서는 localStorage 접근 자체가 throw 하므로
 * 읽기·쓰기를 전부 감싼다. 실패해도 게임은 그냥 새 슬롯으로 시작하면 된다.
 *
 * 토큰과 방 코드는 한 쌍이다. 토큰만 있고 어느 방 것인지 모르면 복귀할 수 없으므로
 * 항상 같이 저장하고 같이 버린다.
 */
const KEY_TOKEN = 'burrow.token';
const KEY_NAME = 'burrow.name';
const KEY_CODE = 'burrow.code';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 저장 못 해도 이번 판은 정상 동작한다. */
  }
};

const drop = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 지우지 못해도 다음 join이 실패하면 어차피 메뉴로 돌아간다. */
  }
};

export const loadToken = (): string | null => read(KEY_TOKEN);
export const saveToken = (token: string): void => write(KEY_TOKEN, token);

export const loadName = (): string | null => read(KEY_NAME);
export const saveName = (name: string): void => write(KEY_NAME, name);

export const loadRoomCode = (): string | null => read(KEY_CODE);
export const saveRoomCode = (code: string): void => write(KEY_CODE, code);

/** 방을 떠났다. 토큰까지 같이 버려야 다음 방에서 남의 자리를 요구하지 않는다. */
export const clearRoom = (): void => {
  drop(KEY_CODE);
  drop(KEY_TOKEN);
};
