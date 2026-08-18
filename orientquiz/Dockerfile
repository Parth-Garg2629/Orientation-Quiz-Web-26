# Multi-stage Dockerfile for OrientQuiz Server
FROM node:22-alpine AS base

WORKDIR /app

# Copy root and workspace definitions
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY server/package*.json ./server/

# Install all workspace dependencies
RUN npm ci

# Copy source files
COPY shared/ ./shared/
COPY server/ ./server/

# Build shared & server
RUN npm run build --workspace=@orientquiz/shared
RUN npm run build --workspace=server

# Production runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# DATABASE_URL is injected by Render at runtime — no default here

COPY package*.json ./
COPY shared/package*.json ./shared/
COPY server/package*.json ./server/

RUN npm ci --omit=dev

COPY --from=base /app/shared/dist ./shared/dist
COPY --from=base /app/server/dist ./server/dist
COPY server/config ./server/config

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace=server"]
