# base image pinned by digest (node:22-bookworm-slim)
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV PORT=3000 DATA_DIR=/data FILES_DIR=/files
EXPOSE 3000
CMD ["node", "server.js"]
