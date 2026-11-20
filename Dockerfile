FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS go-build
WORKDIR /app
COPY backend/go.* ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && CGO_ENABLED=0 go build -trimpath -o /out/worker ./cmd/worker

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 pulsex
COPY --from=web /app/dist /srv
COPY --from=go-build /out/ /usr/local/bin/
ENV STATIC_DIR=/srv HTTP_PORT=8080
EXPOSE 8080
USER 10001
ENTRYPOINT ["/usr/local/bin/api"]
