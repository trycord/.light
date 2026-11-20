# .light — universal per-service runtime image.
# Debian is the fixed OS foundation. Customers select a runtime + version only.
# One image carries every approved runtime; Shade passes LT_RUNTIME and
# LT_RUNTIME_VERSION and the launcher refuses unknown/unpinned combinations.
ARG DEBIAN_BASE=debian:bookworm-slim
FROM ${DEBIAN_BASE}

ARG IMAGE_VERSION=1.0.0
ARG NODE_VERSION=22.14.0
ARG BUN_VERSION=1.2.2
ARG DENO_VERSION=2.0.0
ARG PYTHON_VERSION=3.12.9
ARG JAVA_VERSION=17
ARG DOTNET_VERSION=8.0.13
ARG GO_VERSION=1.23.6
ARG RUST_VERSION=1.84.1
ARG ZIG_VERSION=0.13.0
ARG SWIFT_VERSION=5.10.1
ARG CLOUDFLARED_VERSION=2024.12.2
ARG INSTALL_SWIFT=false
ARG TARGETARCH=amd64

ENV DEBIAN_FRONTEND=noninteractive \
    LIGHT_RUNTIME_IMAGE_VERSION=${IMAGE_VERSION} \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ---- shared Debian userspace + system runtimes provided by bookworm ----
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget xz-utils unzip tar git jq procps openssl \
      build-essential gcc g++ make pkg-config libssl-dev zlib1g-dev libffi-dev \
      python3 python3-pip python3-dev \
      openjdk-${JAVA_VERSION}-jre-headless maven \
      php-cli php-mbstring php-xml php-curl \
      ruby ruby-dev \
      lua5.4 liblua5.4-dev luarocks \
      perl libperl-dev cpanminus \
      erlang elixir \
      postgresql-client redis-tools \
    && rm -rf /var/lib/apt/lists/*

# ---- non-root service user (rootless where practical) ----
RUN groupadd -g 10001 light && useradd -u 10001 -g light -m -d /home/light -s /bin/sh light \
    && mkdir -p /app /opt/runtimes /opt/light \
    && chown -R light:light /app /home/light

# ---- Node.js (pinned exact version) ----
RUN arch=$(case "${TARGETARCH}" in arm64) echo arm64;; *) echo x64;; esac) \
    && mkdir -p "/opt/runtimes/node/${NODE_VERSION}" \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
      | tar -xJ --strip-components=1 -C "/opt/runtimes/node/${NODE_VERSION}"

# ---- Bun ----
RUN bunarch=$(case "${TARGETARCH}" in arm64) echo aarch64;; *) echo x64;; esac) \
    && curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bunarch}.zip" -o /tmp/bun.zip \
    && mkdir -p "/opt/runtimes/bun/${BUN_VERSION}" \
    && unzip -q /tmp/bun.zip -d "/opt/runtimes/bun/${BUN_VERSION}" \
    && chmod +x "/opt/runtimes/bun/${BUN_VERSION}/bun-linux-${bunarch}/bun" \
    && rm /tmp/bun.zip

# ---- Deno ----
RUN denoarch=$(case "${TARGETARCH}" in arm64) echo aarch64;; *) echo x86_64;; esac) \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${denoarch}-unknown-linux-gnu.zip" -o /tmp/deno.zip \
    && mkdir -p "/opt/runtimes/deno/${DENO_VERSION}" \
    && unzip -q /tmp/deno.zip -d "/opt/runtimes/deno/${DENO_VERSION}" \
    && chmod +x "/opt/runtimes/deno/${DENO_VERSION}/deno" \
    && rm /tmp/deno.zip

# ---- Python (exact version, built from source; system python stays for tooling) ----
RUN curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tgz" -o /tmp/python.tgz \
    && tar -xzf /tmp/python.tgz -C /tmp \
    && cd "/tmp/Python-${PYTHON_VERSION}" \
    && ./configure --prefix="/opt/runtimes/python/${PYTHON_VERSION}" --with-ensurepip=install --enable-shared \
    && make -j"$(nproc)" && make install \
    && rm -rf "/tmp/Python-${PYTHON_VERSION}" /tmp/python.tgz

# ---- Go ----
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${TARGETARCH}.tar.gz" -o /tmp/go.tgz \
    && mkdir -p "/opt/runtimes/go/${GO_VERSION}" \
    && tar -xzf /tmp/go.tgz -C "/opt/runtimes/go/${GO_VERSION}" --strip-components=1 \
    && rm /tmp/go.tgz

# ---- Rust (pinned toolchain via rustup, installed to an isolated dir) ----
ENV RUSTUP_HOME=/opt/runtimes/rustup CARGO_HOME=/opt/runtimes/cargo
RUN curl -fsSL https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
    && mkdir -p "/opt/runtimes/rust/${RUST_VERSION}" \
    && cp -a /opt/runtimes/cargo/bin/. "/opt/runtimes/rust/${RUST_VERSION}/" \
    && rm /tmp/rustup.sh

# ---- Zig ----
RUN curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz" -o /tmp/zig.txz \
    && mkdir -p "/opt/runtimes/zig/${ZIG_VERSION}" \
    && tar -xJf /tmp/zig.txz -C "/opt/runtimes/zig/${ZIG_VERSION}" --strip-components=1 \
    && rm /tmp/zig.txz

# ---- .NET SDK (pinned exact version) ----
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
    && chmod +x /tmp/dotnet-install.sh \
    && /tmp/dotnet-install.sh --version "${DOTNET_VERSION}" --install-dir "/opt/runtimes/dotnet/${DOTNET_VERSION}" --no-path \
    && rm /tmp/dotnet-install.sh

# ---- Cloudflared connector (used for per-subdomain tunnels) ----
RUN cfarch=$(case "${TARGETARCH}" in arm64) echo arm64;; *) echo amd64;; esac) \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${cfarch}" -o /usr/local/bin/cloudflared \
    && chmod 0755 /usr/local/bin/cloudflared

# ---- Swift (optional: large, limited Debian support) ----
RUN if [ "${INSTALL_SWIFT}" = "true" ]; then \
      echo "Swift ${SWIFT_VERSION} install is operator-supplied via /opt/runtimes/swift/${SWIFT_VERSION}"; \
    fi

# ---- launcher + health helper ----
COPY light-launch.sh /usr/local/bin/light-launch
COPY light-health.sh /usr/local/bin/light-health
COPY manifest.json /opt/light/manifest.json
RUN chmod 0755 /usr/local/bin/light-launch /usr/local/bin/light-health \
    && chown -R light:light /opt/runtimes /opt/light

USER light
WORKDIR /app

LABEL org.opencontainers.image.title=".light universal service runtime" \
      org.opencontainers.image.vendor="Trycord" \
      org.opencontainers.image.description="Debian-based per-service runtime image" \
      light.os="debian" \
      light.image.version="${IMAGE_VERSION}"

ENTRYPOINT ["/usr/local/bin/light-launch"]
CMD ["sh", "-c", "echo 'No startup command configured'; exec sleep infinity"]
