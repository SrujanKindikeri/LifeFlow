# ============================================================
# LifeFlow — Production Dockerfile
# Multi-stage build using Next.js standalone output
#
# Targets: AWS EC2, Azure VM, or any Docker host.
# One image works on all platforms — no cloud-specific code.
#
# Build:
#   docker build -t lifeflow:latest .
#
# Run:
#   docker run -p 3000:3000 \
#     -e MONGODB_URI="mongodb+srv://..." \
#     -e SESSION_SECRET="..." \
#     -e SCHEDULER_SECRET="..." \
#     -e NEXT_PUBLIC_APP_URL="http://<your-host>:3000" \
#     lifeflow:latest
#
# SECURITY: The image does NOT contain any secrets.
# All configuration is supplied at runtime via environment
# variables — never at build time.
# ============================================================

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# Install ALL dependencies (dev + prod) needed for the build step.
# Separated so this layer is cached when only source files change.
FROM node:22-alpine AS deps

# libc6-compat — required by some native modules (bcryptjs, sharp, etc.)
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy only manifests first — maximises layer-cache hits
COPY package.json package-lock.json* ./

# Install all deps (including devDependencies needed for `next build`)
RUN npm ci --frozen-lockfile

# ── Stage 2: builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Bring in dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (all files not excluded by .dockerignore)
COPY . .

# ── Build-time environment ────────────────────────────────────────────────────
# NEXT_TELEMETRY_DISABLED — suppress Next.js telemetry during build
# NODE_ENV=production    — enables production optimisations in Next.js
# NEXT_PUBLIC_* vars may be baked into the bundle at build time.
# Server-side secrets (MONGODB_URI, SESSION_SECRET, etc.) are NOT needed
# here and must NOT be passed as build args — they are runtime-only.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build Next.js with standalone output (configured in next.config.ts)
# .next/standalone is a self-contained minimal server — no node_modules copy needed.
RUN npm run build

# ── Stage 3: runner ───────────────────────────────────────────────────────────
# Minimal production image — only the standalone output + public assets.
# No source code, no node_modules, no devDependencies, no build tools.
#
# Group Bill Receipt Scanner — Ollama networking notes:
#
#   The scanner uses a two-tier pipeline:
#     1. Ollama local vision model  (if OLLAMA_BASE_URL is reachable)
#     2. Tesseract.js HOCR parser   (always available, zero config)
#
#   If Ollama runs on the Docker HOST:
#     - Linux:   use --network=host  OR  OLLAMA_BASE_URL=http://172.17.0.1:11434
#     - macOS/Windows: use OLLAMA_BASE_URL=http://host.docker.internal:11434
#
#   If Ollama runs in a separate container on the same compose network:
#     - Set OLLAMA_BASE_URL=http://<ollama-service-name>:11434
#
#   Leave OLLAMA_BASE_URL empty to skip Ollama and use Tesseract only.
#   The app NEVER calls OpenAI, Gemini, or any paid cloud API.
FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat curl

WORKDIR /app

# ── Runtime environment defaults ──────────────────────────────────────────────
# These can all be overridden via `docker run -e ...` or compose environment.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Port the server listens on inside the container
ENV PORT=3000
# Bind to all interfaces so Docker port-mapping works correctly
ENV HOSTNAME=0.0.0.0

# ── Non-root user ─────────────────────────────────────────────────────────────
# Running as a non-root user limits the blast radius if the app is compromised.
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# ── Copy standalone build output ──────────────────────────────────────────────
# .next/standalone — minimal server.js + required node modules
# .next/static      — hashed CSS/JS chunks (served by Next.js or a CDN)
# public/           — static assets (favicon, robots.txt, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

# ── Switch to non-root user ────────────────────────────────────────────────────
USER nextjs

# ── Expose port ────────────────────────────────────────────────────────────────
EXPOSE 3000

# ── Health check ───────────────────────────────────────────────────────────────
# Uses curl (installed above) against the loopback address.
# --interval  30s  — check every 30 seconds
# --timeout   10s  — fail if no response within 10 seconds
# --start-period 30s — give the app time to cold-start before counting failures
# --retries   3    — mark unhealthy after 3 consecutive failures
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# ── Start the application ──────────────────────────────────────────────────────
# server.js is the standalone entry point generated by Next.js.
# It respects PORT and HOSTNAME environment variables.
CMD ["node", "server.js"]
