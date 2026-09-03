# syntax=docker/dockerfile:1
# golang:1.26-alpine — digest-pinned for supply-chain integrity (Renovate bumps the digest)
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:ce864e7223ac17b1775e6fd0b4c0db580c2eb50e7953a427916379e4b92a1628 AS builder
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
