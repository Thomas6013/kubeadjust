# syntax=docker/dockerfile:1

# deps and builder pin to $BUILDPLATFORM so `npm ci` and `next build` always run
# natively on the runner's own architecture. Without this they default to
# $TARGETPLATFORM, so the linux/arm64 half of the matrix compiled the whole
# frontend inside QEMU: a cold build took over 45 minutes against 1m16s for the
# backend, which already plays this trick via Go's cross-compilation. It is a
# no-op for the amd64 target, where BUILDPLATFORM == TARGETPLATFORM.
#
# Only `runner` stays on $TARGETPLATFORM, so the published image is a genuine
# arm64 image running the arm64 Node from its own base layer. All we moved is
# where the JavaScript is produced, and JavaScript has no architecture.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next traces `sharp` into the standalone output for the platform it built on,
# which is now always amd64 (see the note at the top). On an arm64 image those
# .node binaries cannot load. Nothing here uses next/image, so sharp is never
# required at runtime and the mismatch is inert -- but leaving an amd64 binary
# in an arm64 image is a trap: the first <Image> added would fail with an
# "invalid ELF header" rather than something diagnosable. Dropping it makes
# that future failure say "sharp missing", which is the actual problem.
# Left in place for amd64, where the binary is the right one.
ARG TARGETARCH
RUN if [ "$TARGETARCH" != "amd64" ]; then rm -rf ./node_modules/@img; fi

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
