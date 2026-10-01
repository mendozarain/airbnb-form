# One image, three Lambda functions (API, light worker, browser worker) and a migration function; each function
# overrides CMD with its handler. Built on Debian (not the Amazon Linux Lambda base image) so Playwright's
# Chromium and its system libraries install exactly as they always have.
FROM node:22-bookworm

ENV LAMBDA_TASK_ROOT=/var/task \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/tmp \
    NODE_ENV=production

# Lambda Runtime Interface Client: lets Lambda run this image. It compiles a native addon, hence the toolchain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ make cmake unzip libcurl4-openssl-dev autoconf automake libtool \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --prefix /opt/ric aws-lambda-ric@^3

WORKDIR /var/task

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY shared/package.json shared/package.json
COPY infra/package.json infra/package.json
RUN NODE_ENV=development npm ci --workspace backend --workspace shared
RUN npx playwright install --with-deps chromium

COPY backend backend
COPY shared shared
COPY tsconfig.base.json tsconfig.base.json
RUN npm run build --workspace shared && npm run build --workspace backend

ENTRYPOINT ["/opt/ric/node_modules/.bin/aws-lambda-ric"]
CMD ["backend/dist/lambda.handler"]
