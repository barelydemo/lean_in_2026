# ── build ────────────────────────────────────────────────────────────────
FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Cache dependencies separately from source.
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

# ── runtime ──────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 lexical && mkdir -p /data && chown lexical /data
WORKDIR /app
COPY --from=build /app/target/release/lexical-server /usr/local/bin/lexical-server
COPY content ./content
ENV BIND=0.0.0.0:8080 DATA_DIR=/data LOG_FORMAT=json COURSES_DIR=/app/content/courses
USER lexical
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD ["/bin/sh", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /healthz HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q ok <&3"]
CMD ["lexical-server"]
