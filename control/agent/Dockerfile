FROM node:24-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN mv /root/.cache/ms-playwright /opt/browsers && chmod -R a+rX /opt/browsers && mkdir -p /opt/runtime /app/data && chown 1000:1000 /app/data && ln -s /app/node_modules /opt/runtime/node_modules
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
COPY runtime/ /opt/runtime/
USER 1000:1000
WORKDIR /tmp
CMD ["node","/opt/runtime/probe.mjs"]
