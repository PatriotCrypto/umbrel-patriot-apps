FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
EXPOSE 3959
# Starts as root only to make /data writable, then drops to uid 1000 (see server.js).
CMD ["node", "server.js"]
