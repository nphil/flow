# Flow — standalone web app image.
# Serves the same static bundle the HACS release ships, for use outside
# Home Assistant (connect screen asks for HA URL + long-lived token).
# Requires `yarn build:ha` output present in custom_components/flow/www.
FROM nginx:1.27-alpine

COPY custom_components/flow/www /usr/share/nginx/html

RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  gzip on;' \
  '  gzip_types text/css application/javascript application/json image/svg+xml;' \
  '  location /assets/ {' \
  '    add_header Cache-Control "public, max-age=31536000, immutable";' \
  '  }' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
