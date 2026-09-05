# syntax=docker/dockerfile:1
#
# Replicate Prompt Orchestrator — static SPA served by nginx.
# BYOK: paste your REPLICATE_API_TOKEN (and Venice/OpenRouter keys for the
# enhancer) in the browser UI. No secrets are baked into this image —
# only the contents of public/ are copied.
#
# Build: docker build -t replicate-orchestrator .
# Run:   docker run --rm -p 8000:80 replicate-orchestrator
# Open:  http://localhost:8000
#
# Note: for the full backend (hidden-token Worker proxy at /api/*),
# deploy to Cloudflare with `wrangler deploy` instead. The SPA detects
# the missing proxy and falls back to direct browser → API calls.

FROM nginx:alpine

# SPA assets only — .env / .dev.vars / node_modules never enter the image
COPY public/ /usr/share/nginx/html/

EXPOSE 80

# nginx default conf serves index.html at / and 404s /api/*,
# which is exactly what the SPA expects for its direct-API fallback.
CMD ["nginx", "-g", "daemon off;"]
