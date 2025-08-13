# 56k Knowledge Hub - Docker Configuration
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create app user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S knowledgehub -u 1001

# Create necessary directories
RUN mkdir -p data logs public
RUN chown -R knowledgehub:nodejs /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application files
COPY --chown=knowledgehub:nodejs . .

# Create data and logs directories
RUN mkdir -p data logs public

# Switch to non-root user
USER knowledgehub

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "server.js"]