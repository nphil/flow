# https://developers.home-assistant.io/docs/apps/configuration#app-dockerfile
#
# Base images are now published as multi-platform (amd64 + aarch64) manifests, so one
# generic tag covers both architectures this add-on declares in config.yaml -- no
# build.yaml / per-arch build_from map needed (see the builder-migration notes at
# https://developers.home-assistant.io/blog/2026/04/02/builder-migration). Pinned to an
# immutable tag rather than :latest, per the "pinning recommended" note on the same page.
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.24-2026.08.0
FROM ${BUILD_FROM}

# Supervisor (and the home-assistant/builder GitHub Actions, if this add-on ever grows a
# publish workflow) supply BUILD_VERSION automatically, read from this add-on's own
# config.yaml `version` key. Building the download URL from it means the fetched release
# and the add-on version can never drift apart -- bump config.yaml, nothing else to touch.
ARG BUILD_VERSION=1.0.1

# flow.tar.gz is the tarball of custom_components/flow (built by .github/workflows/release.yml
# as `cd custom_components/flow && tar -czf ../../flow.tar.gz .`), so `www/` is a top-level
# directory inside the archive. Extract everything to a scratch dir, keep only www/.
RUN \
    apk add --no-cache \
        curl \
        nginx \
        tar \
    && mkdir -p /run/nginx /var/www/flow /tmp/flow-release \
    && curl -sSLf -o /tmp/flow.tar.gz \
        "https://github.com/nphil/flow/releases/download/v${BUILD_VERSION}/flow.tar.gz" \
    && tar -xzf /tmp/flow.tar.gz -C /tmp/flow-release \
    && cp -r /tmp/flow-release/www/. /var/www/flow/ \
    && rm -rf /tmp/flow.tar.gz /tmp/flow-release

# rootfs/etc/nginx/http.d/default.conf replaces Alpine's stock nginx server block.
COPY rootfs /

LABEL \
    org.opencontainers.image.title="Flow Web" \
    org.opencontainers.image.description="Flow automation editor as a standalone web app" \
    org.opencontainers.image.source="https://github.com/nphil/flow" \
    org.opencontainers.image.licenses="MIT"

EXPOSE 80

# init: false in config.yaml (required -- the base image's s6-overlay v3 ENTRYPOINT
# stays PID 1) + a plain foreground CMD is the documented pattern for add-ons that don't
# need their own s6 service scripts; see the "Hello world" tutorial at
# https://developers.home-assistant.io/docs/apps/tutorial.
CMD [ "nginx", "-g", "daemon off;" ]
