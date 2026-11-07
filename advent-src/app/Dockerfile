FROM node:22-alpine
ENV NODE_ENV=production PORT=3981 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3981
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:${PORT:-3981}/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
