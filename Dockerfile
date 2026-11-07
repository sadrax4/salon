FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
RUN DATABASE_URL=postgresql://x:x@localhost:5432/x npx prisma generate && DATABASE_URL=postgresql://x:x@localhost:5432/x npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "docker-entrypoint.sh"]
