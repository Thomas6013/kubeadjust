# syntax=docker/dockerfile:1
# golang:1.27-alpine — digest-pinned for supply-chain integrity (Renovate bumps the digest)
FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:738d1cf061836894ff6bb8c33881080ac66de8cf0586615012a0c8f592649cfa AS builder
ARG TARGETOS TARGETARCH
WORKDIR /app
RUN apk add --no-cache tzdata
COPY . .
RUN go mod download && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags="-s -w" -o kubeadjust-backend .

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /app/kubeadjust-backend /kubeadjust-backend
# Run as nobody (65534) — the static binary needs no write access and no user DB,
# so a numeric UID works on scratch. Defense-in-depth beyond the Helm securityContext.
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/kubeadjust-backend"]
