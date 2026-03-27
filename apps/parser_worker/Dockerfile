FROM node:20-bookworm-slim AS build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV WORKER_MODE=api
ENV API_BASE_URL=http://backend:3000
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps chromium chromium-headless-shell

COPY --from=build /app/dist ./dist

CMD ["node", "dist/main.js"]
