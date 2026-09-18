/**
 * "팀원이 브라우저에 주소만 치면 들어와진다"를 성립시키는 부분.
 *
 * 사설 IP를 직접 찾아서 콘솔에 큼직하게 찍어 준다. 이걸 사람이 ifconfig로
 * 찾아야 한다면, 게임을 켜는 데 드는 마찰이 실제 플레이 빈도를 갉아먹는다.
 */
import { networkInterfaces } from 'node:os';

interface Candidate {
  address: string;
  iface: string;
  rank: number;
}

/** 같은 LAN의 다른 기기가 실제로 접속할 수 있는 IPv4 주소들. */
export const lanAddresses = (): string[] => {
  const found: Candidate[] = [];
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      // 링크 로컬(169.254.x)은 실제로 통신이 안 되는 경우가 많아 뒤로 민다.
      const rank = ni.address.startsWith('169.254.') ? 1 : 0;
      found.push({ address: ni.address, iface, rank });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.iface.localeCompare(b.iface));
  return found.map((c) => c.address);
};

/** 한글이 섞인 줄도 폭이 맞도록, CJK를 2칸으로 센다. */
const visualWidth = (s: string): number =>
  [...s].reduce((n, c) => n + (c.codePointAt(0)! > 0x2000 ? 2 : 1), 0);

const box = (lines: string[]): string => {
  const width = Math.max(...lines.map(visualWidth));
  const bar = '-'.repeat(width + 2);
  const body = lines.map((l) => `| ${l}${' '.repeat(width - visualWidth(l))} |`);
  return [`+${bar}+`, ...body, `+${bar}+`].join('\n');
};

export const printBanner = (port: number): void => {
  // 배포 환경에서는 컨테이너 내부 IP를 찍어 봐야 아무 쓸모가 없다.
  // PUBLIC_URL이 있으면 그걸 정답으로 쓴다.
  const publicUrl = process.env.PUBLIC_URL?.trim();
  if (publicUrl) {
    console.log(
      '\n' +
        box([
          '고지전 - 서버 가동',
          '',
          '접속 주소:',
          `   ${publicUrl}`,
          '',
          `내부 포트: ${port}`,
        ]) +
        '\n',
    );
    return;
  }

  const addrs = lanAddresses();
  console.log(
    '\n' +
      box([
        '고지전 - LAN 대전 서버',
        '',
        '팀원에게 이 주소를 보내세요:',
        ...(addrs.length > 0
          ? addrs.map((a) => `   http://${a}:${port}`)
          : ['   (LAN 주소를 찾지 못했습니다. Wi-Fi/이더넷 연결을 확인하세요)']),
        '',
        `내 브라우저:  http://localhost:${port}`,
        '',
        'macOS에서 처음 켜면 방화벽이 수신 허용을 물어봅니다 - 허용하세요.',
        '종료: Ctrl+C',
      ]) +
      '\n',
  );
};
