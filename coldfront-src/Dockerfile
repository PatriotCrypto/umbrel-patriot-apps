# Dependencies are pure JavaScript, so install them once on the build machine's own
# architecture (no emulation) and copy them into the final image for any platform.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=2000

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3971 DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
EXPOSE 3971
# starts as root only to chown /data, then drops to uid 1000 (see server.js)
CMD ["node", "server.js"]
