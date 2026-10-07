# Tinker API and worker image (one image, two commands). Build from the repository root:
#   docker build -t tinker-server .
# API (default):   docker run -p 8787:8787 --env-file prod.env tinker-server
# Worker:          docker run --env-file prod.env tinker-server node --import tsx server/src/worker.ts
# Migrations:      docker run --env-file prod.env tinker-server npm run db:migrate -w @tinker/server
# Needs no secrets at build time; every setting arrives as an environment variable at run time (see docs/runbook.md).
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
# Production dependencies of the API and shared contracts only (no frontend toolkit, no test or embedded-database packages).
RUN npm ci --omit=dev --workspace=@tinker/server --workspace=@tinker/shared --include-workspace-root=false

FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server/package.json server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/migrations ./server/migrations
# The public Supabase root certificate, so the API can VERIFY the database (set DATABASE_SSL_CA_FILE=/app/server/certs/supabase-ca.crt).
COPY server/certs ./server/certs
RUN chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# `node` itself is PID 1 (no npx/tsx wrapper in between), so the stop signal from the host reaches the API and it shuts down gracefully.
CMD ["node", "--import", "tsx", "server/src/main.ts"]
