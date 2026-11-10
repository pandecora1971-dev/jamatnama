# Scan worker image. Not exercised locally: Docker was unavailable during verification.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib ./lib
COPY worker ./worker
COPY public/data ./public/data
USER node
CMD ["node", "--import", "tsx", "worker/scan-worker.mts"]
