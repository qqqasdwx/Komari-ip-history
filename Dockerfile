FROM node:22-bookworm AS web-build

WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

RUN npm run build


FROM golang:1.25-bookworm AS app-build

WORKDIR /src

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=web-build /src/public ./public

RUN go build -o /out/ipq ./cmd/ipq


FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --gid nogroup --home /app --shell /usr/sbin/nologin ipq \
    && mkdir -p /app/public /data \
    && chown -R ipq:nogroup /app /data

WORKDIR /app

COPY --from=app-build /out/ipq /app/ipq
COPY --from=web-build /src/public /app/public
COPY deploy/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

ENV IPQ_APP_ENV=production
ENV GIN_MODE=release
ENV IPQ_LISTEN=:8090
ENV IPQ_DB_PATH=/data/ipq.db

VOLUME ["/data"]
EXPOSE 8090

ENTRYPOINT ["/app/docker-entrypoint.sh"]
