# Multi-stage build for production
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S orchestrator -u 1001

# Copy built application
COPY --from=builder --chown=orchestrator:nodejs /app/dist ./dist
COPY --from=builder --chown=orchestrator:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=orchestrator:nodejs /app/package*.json ./

# Create logs directory
RUN mkdir -p logs && chown orchestrator:nodejs logs

# Switch to non-root user
USER orchestrator

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT:-8080}/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Expose port
EXPOSE 8080

# Start application with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/app.js"]