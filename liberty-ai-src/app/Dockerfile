FROM node:22-alpine
ENV NODE_ENV=production PORT=3979 DATA_DIR=/data STORAGE_DIR=/storage
# poppler-utils gives Liberty AI pdftotext, so PDFs in your folders can be searched.
RUN apk add --no-cache poppler-utils
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data /storage
EXPOSE 3979
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT:-3979}/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
