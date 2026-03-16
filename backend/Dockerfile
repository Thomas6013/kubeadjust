# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder
ARG TARGETOS TARGETARCH
WORKDIR /app
RUN apk add --no-cache tzdata
COPY . .
RUN go mod download && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags="-s -w" -o kubeadjust-backend .

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /app/kubeadjust-backend /kubeadjust-backend
EXPOSE 8080
ENTRYPOINT ["/kubeadjust-backend"]
