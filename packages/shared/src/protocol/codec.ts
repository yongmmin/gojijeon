/**
 * 직렬화 계층. 여기 말고 어디서도 JSON.stringify를 부르지 않는다.
 * 나중에 바이너리로 갈아탈 때 고칠 파일이 이것 하나가 되도록.
 */
import type { ClientMessage, ServerMessage } from './messages.js';

export const encodeClient = (m: ClientMessage): string => JSON.stringify(m);
export const encodeServer = (m: ServerMessage): string => JSON.stringify(m);

export const decodeClient = (raw: string): ClientMessage | null => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v.t === 'string' ? (v as ClientMessage) : null;
  } catch {
    return null;
  }
};

export const decodeServer = (raw: string): ServerMessage | null => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v.t === 'string' ? (v as ServerMessage) : null;
  } catch {
    return null;
  }
};
