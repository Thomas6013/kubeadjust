# syntax=docker/dockerfile:1
# golang:1.26-alpine — digest-pinned for supply-chain integrity (Renovate bumps the digest)
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:91eda9776261207ea25fd06b5b7fed8d397dd2c0a283e77f2ab6e91bfa71079d AS builder
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
