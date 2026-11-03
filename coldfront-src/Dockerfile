FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3971 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
EXPOSE 3971
# starts as root only to chown /data, then drops to uid 1000 (see server.js)
CMD ["node", "server.js"]
