FROM node:22-bookworm AS node
FROM golang:1.25-bookworm

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/bin/corepack /usr/local/bin/corepack
COPY --from=node /usr/local/include/node /usr/local/include/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node /usr/local/share/doc/node /usr/local/share/doc/node
COPY --from=node /usr/local/share/man/man1/node.1 /usr/local/share/man/man1/node.1

ENV PATH="/usr/local/go/bin:/usr/local/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH="/ms-playwright"

RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/local/go/bin/go /usr/local/bin/go \
    && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && mkdir -p /workspace /root/.npm /root/.cache/go-build /go/pkg/mod \
    && npx -y playwright@1.58.2 install --with-deps chromium \
    && go version \
    && node --version \
    && npm --version

WORKDIR /workspace

CMD ["sh", "-lc", "tail -f /dev/null"]
