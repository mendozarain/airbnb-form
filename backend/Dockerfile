FROM node:22-bookworm
LABEL org.opencontainers.image.title="cozy-d-714-api"

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY shared/package.json shared/package.json
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY backend backend
COPY shared shared
COPY tsconfig.base.json tsconfig.base.json
RUN npm run build --workspace shared && npm run build --workspace backend

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npm run migrate:deploy --workspace backend && node backend/dist/main.js"]
