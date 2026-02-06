# Hunter S. Clawmpson Daemon
# Deployment target: Fly.io
#
# TODO: Complete this Dockerfile once Moltbook API access is available
# Current status: PLACEHOLDER

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Environment
ENV NODE_ENV=production
ENV DRY_RUN=true

# Run the daemon
CMD ["node", "dist/index.js"]
