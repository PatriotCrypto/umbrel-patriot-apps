# Bible Terminal: pinned Node 22 on Alpine (digest pinned so builds are repeatable)
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

# xz + mtools + openssl are only used by the Pi hotspot image builder
RUN apk add --no-cache xz mtools openssl

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
COPY hotspot ./hotspot
COPY data ./data

ENV NODE_ENV=production PORT=3953 DATA_DIR=/data
EXPOSE 3953
# starts as root only to fix ownership of /data, then drops to uid 1000 (see server/index.js)
CMD ["node", "server/index.js"]
