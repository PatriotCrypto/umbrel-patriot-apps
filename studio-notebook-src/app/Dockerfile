# syntax=docker/dockerfile:1

# Stage 1: build the offline word data from pinned, freely licensed sources.
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS data
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
# Moby Thesaurus II (public domain). Fetched as a plain file and checked by hash.
ADD --checksum=sha256:68f8b3074d088efe33c1ef8064b76bece39f7774f1718fd7b48125386100b083 \
    https://registry.npmjs.org/moby/-/moby-1.1.2.tgz /tmp/moby.tgz
COPY scripts ./scripts
COPY data-src ./data-src
RUN tar -xzf /tmp/moby.tgz -C /tmp package/words.txt \
 && node scripts/build-data.js --moby /tmp/package/words.txt

# Stage 2: the app itself. No npm packages at run time.
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
ENV NODE_ENV=production PORT=3983 DATA_DIR=/data
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY data-src/figures.json ./data-src/figures.json
COPY --from=data /build/data ./data
USER 1000:1000
EXPOSE 3983
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3983/healthz || exit 1
CMD ["node", "server.js"]
