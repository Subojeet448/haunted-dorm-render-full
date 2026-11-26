FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# deps first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# app code + game files
COPY server.js ./
COPY public ./public

# run as non-root
USER node
EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server.js"]
