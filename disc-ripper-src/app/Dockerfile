# ---- stage 1: build MakeMKV from source (downloaded from makemkv.com, checksum-verified) ----
FROM node:22-bookworm AS makemkv
ARG MAKEMKV_VERSION=2.0.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev libexpat1-dev zlib1g-dev libavcodec-dev libavutil-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN set -eux; \
    for p in oss bin; do curl -fsSL -O "https://www.makemkv.com/download/makemkv-$p-${MAKEMKV_VERSION}.tar.gz"; done; \
    curl -fsSL -O "https://www.makemkv.com/download/makemkv-sha-${MAKEMKV_VERSION}.txt"; \
    for p in oss bin; do grep " makemkv-$p-${MAKEMKV_VERSION}.tar.gz\$" "makemkv-sha-${MAKEMKV_VERSION}.txt" | sha256sum -c -; done; \
    tar xzf "makemkv-oss-${MAKEMKV_VERSION}.tar.gz"; tar xzf "makemkv-bin-${MAKEMKV_VERSION}.tar.gz"; \
    cd "makemkv-oss-${MAKEMKV_VERSION}"; ./configure --prefix=/usr --disable-gui; make -j"$(nproc)"; make install; \
    cd "../makemkv-bin-${MAKEMKV_VERSION}"; mkdir -p tmp; echo accepted > tmp/eula_accepted; make install

# a tiny helper that asks the drive whether its tray is open
COPY native/cdstatus.c /build/cdstatus.c
RUN gcc -O2 -o /usr/local/bin/cdstatus /build/cdstatus.c

# ---- stage 2: the app ----
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libssl3 libexpat1 zlib1g libavcodec59 libavutil57 util-linux eject ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=makemkv /usr/bin/makemkvcon /usr/bin/mmgplsrv /usr/bin/mmccextr /usr/bin/
COPY --from=makemkv /usr/lib/libdriveio.so.0 /usr/lib/libmakemkv.so.1 /usr/lib/libmmbd.so.0 /usr/lib/
COPY --from=makemkv /usr/share/MakeMKV /usr/share/MakeMKV
COPY --from=makemkv /usr/local/bin/cdstatus /usr/local/bin/cdstatus
RUN ldconfig && makemkvcon -r info disc:9999 > /dev/null 2>&1 || true
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV PORT=3000 DATA_DIR=/data MEDIA_DIR=/media DOWNLOADS_DIR=/downloads
EXPOSE 3000
CMD ["node", "server.js"]
