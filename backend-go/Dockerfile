# Multi-stage production build for Granete Go backend
# 1. Builder stage
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /src

# Download dependencies first for Docker layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code and migrations
COPY . .

# Build statically linked binaries
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/muebles-server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/muebles-admin ./cmd/admin

# 2. Minimal production runtime
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata wget

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy compiled binaries from builder
COPY --from=builder /bin/muebles-server /app/server
COPY --from=builder /bin/muebles-admin /app/admin

# Create media upload directory with correct permissions
RUN mkdir -p /data/media && chown -R appuser:appgroup /data/media /app

USER appuser

EXPOSE 8080

ENV PORT=8080 \
    MEDIA_DIR=/data/media

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/health || exit 1

ENTRYPOINT ["/app/server"]
