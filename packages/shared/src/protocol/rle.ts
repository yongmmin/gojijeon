/**
 * 타일 맵 압축.
 *
 * 128×128 = 16384바이트를 그대로 보내도 LAN에서는 견디지만, 맵 대부분이
 * 같은 값으로 이어져 있어서 RLE 한 번이면 보통 2~4KB로 떨어진다.
 * run 하나 = [타일 id(1B)][길이(2B, LE)].
 */
export const encodeRLE = (data: Uint8Array): string => {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let len = 1;
    while (i + len < data.length && data[i + len] === v && len < 0xffff) len++;
    out.push(v, len & 0xff, (len >> 8) & 0xff);
    i += len;
  }
  return bytesToBase64(Uint8Array.from(out));
};

export const decodeRLE = (b64: string, expectedLength: number): Uint8Array => {
  const bytes = base64ToBytes(b64);
  const out = new Uint8Array(expectedLength);
  let o = 0;
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const v = bytes[i];
    const len = bytes[i + 1] | (bytes[i + 2] << 8);
    out.fill(v, o, o + len);
    o += len;
  }
  return out;
};

// Node와 브라우저 양쪽에서 도는 base64. 이 파일이 shared에 있는 이유가 그것이다.
const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
};

const base64ToBytes = (b64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
