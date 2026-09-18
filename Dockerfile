# 고지전 — 어디서든 도는 단일 컨테이너.
#
# 이 게임은 방 상태를 메모리에 들고 20Hz로 도는 **상태 있는 WebSocket 서버**다.
# 서버리스(Vercel/Netlify/Lambda)에는 올라가지 않는다. 늘 떠 있는 프로세스가
# 필요하고, 그래서 컨테이너 하나로 끝나게 만들어 두었다.

FROM node:20-slim AS build
WORKDIR /app
COPY . .
# 빌드에 devDependencies(타입스크립트·vite)가 필요하므로 먼저 전부 설치하고,
# 빌드가 끝난 뒤에 덜어낸다.
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# 워크스페이스 심링크가 살아 있어야 @gojijeon/shared가 해석되므로
# node_modules와 각 패키지의 package.json을 함께 옮긴다.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist

EXPOSE 8080
# 컨테이너에서는 PID 1이 시그널을 받아야 정상 종료된다. node가 SIGTERM을 직접 처리한다.
CMD ["node", "packages/server/dist/main.js"]
