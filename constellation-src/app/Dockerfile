FROM node:22-alpine
ENV NODE_ENV=production PORT=3977 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY data ./data
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
EXPOSE 3977
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT:-3977}/api/auth/status >/dev/null || exit 1
CMD ["node", "server.js"]
