import { defineConfig } from 'vite';

export default defineConfig({
  // 서버가 이 결과물을 그대로 정적 서빙한다. 팀원은 URL 하나만 받으면 된다.
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    // 개발 중에는 Vite가 앞단, 게임 서버가 8080. 소켓만 프록시한다.
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
