/**
 * 진입점.
 *
 * HTTP 한 포트에서 클라이언트 정적 파일과 게임 소켓을 동시에 낸다.
 * 팀원이 받는 것이 "주소 하나"여야 한다는 요구에서 나온 구조다.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { NET } from '@gojijeon/shared';
import { RoomManager } from './room/manager.js';
import { printBanner } from './host/lan.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT_DIR = resolve(here, '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8">
<title>고지전</title>
<body style="font-family:system-ui;background:#11141b;color:#e5e7eb;padding:48px;line-height:1.7">
<h1>클라이언트가 아직 빌드되지 않았습니다</h1>
<p>터미널에서 다음을 실행하세요:</p>
<pre style="background:#1b1f28;padding:16px;border-radius:8px">npm run build</pre>
<p>개발 중이라면 <code>npm run dev</code> 로 띄우고 <a style="color:#60a5fa" href="http://localhost:5173">localhost:5173</a> 을 여세요.</p>
</body>`;

const serveStatic = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // 경로 탈출(../) 차단. 사내망이라도 디렉토리 전체를 노출할 이유는 없다.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(CLIENT_DIR, rel === '/' ? 'index.html' : rel);
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      // 라운드마다 새로고침하는 사람이 있으므로 캐시는 짧게.
      'cache-control': rel === '/' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(body);
  } catch {
    // SPA 폴백. 빌드 자체가 없으면 안내 페이지.
    try {
      const body = await readFile(join(CLIENT_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(body);
    } catch {
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(NOT_BUILT);
    }
  }
};

const port = Number(process.env.PORT ?? NET.port);
const rooms = new RoomManager();

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rooms.status));
    return;
  }
  void serveStatic(req, res);
});

const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (socket) => rooms.attach(socket));

// ws는 http 서버의 'error'를 자기 자신에게 되쏜다. 여기서 받아 주지 않으면
// 아래의 포트 재시도가 돌기도 전에 unhandled 'error'로 프로세스가 죽는다.
wss.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') return; // 포트 처리는 http 쪽 리스너가 한다
  console.error('소켓 서버 오류:', err.message);
});

rooms.start();

/**
 * 포트가 막혀 있으면 옆 포트로 옮겨 간다.
 *
 * 이건 개발 서버가 아니라 "게임 켜는 버튼"이다. 다른 프로젝트가 8080을 쓰고
 * 있다는 이유로 스택트레이스를 뱉고 죽으면, 게임을 하려던 사람이 포트를
 * 찾아 헤매게 된다. 대신 옮겨 간 사실을 반드시 알린다 — 주소가 달라지니까.
 */
const MAX_PORT_TRIES = 12;

// listen 콜백을 재시도마다 새로 넘기면, 실패한 시도의 콜백도 리스너로 남아
// 성공할 때 함께 발화한다(= 배너가 여러 번, 그것도 틀린 포트로 찍힌다).
// 'listening'을 딱 한 번만 걸고 실제 바인딩된 포트를 읽는 편이 안전하다.
http.once('listening', () => {
  const actual = (http.address() as AddressInfo).port;
  if (actual !== port) {
    console.log(`\n주의: 원래 포트(${port})가 막혀 ${actual}으로 띄웠습니다.`);
  }
  printBanner(actual);
});

let attempt = 0;
http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE' || attempt >= MAX_PORT_TRIES) {
    console.error(`\n서버를 시작하지 못했습니다: ${err.message}\n`);
    process.exit(1);
  }
  attempt += 1;
  const next = port + attempt;
  console.log(`포트 ${port + attempt - 1}이(가) 사용 중입니다. ${next}로 옮깁니다.`);
  http.listen(next, '0.0.0.0');
});

// 0.0.0.0 바인드가 핵심이다. localhost로 묶으면 팀원이 절대 못 들어온다.
http.listen(port, '0.0.0.0');

const shutdown = (): void => {
  rooms.stop();
  wss.close();
  http.close(() => process.exit(0));
  // 소켓이 안 닫히는 경우를 대비한 보험.
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
