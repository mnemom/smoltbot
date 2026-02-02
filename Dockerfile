# Smoltbot - OpenClaw with AAP tracing
FROM node:22-bookworm

# Install Tailscale
COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscale /usr/local/bin/tailscale
RUN mkdir -p /var/run/tailscale /var/lib/tailscale

# Create non-root user
RUN useradd -m -s /bin/bash smoltbot

WORKDIR /home/smoltbot

# Install OpenClaw globally
RUN npm install -g openclaw@latest

# Copy and build the smoltbot plugin
COPY --chown=smoltbot:smoltbot plugin/package*.json ./plugin/
RUN cd plugin && npm ci

COPY --chown=smoltbot:smoltbot plugin/ ./plugin/
RUN cd plugin && npm run build

# Set up OpenClaw extensions directory and link plugin
# Scoped packages need @scope/name directory structure
RUN mkdir -p /home/smoltbot/.openclaw/extensions/@mnemom && chown -R smoltbot:smoltbot /home/smoltbot/.openclaw
RUN ln -s /home/smoltbot/plugin /home/smoltbot/.openclaw/extensions/@mnemom/smoltbot

# Create smoltbot config directory
RUN mkdir -p /home/smoltbot/.smoltbot && chown -R smoltbot:smoltbot /home/smoltbot/.smoltbot

# Create /data directory for Fly.io volume mount (OPENCLAW_STATE_DIR)
RUN mkdir -p /data && chown smoltbot:smoltbot /data

# Create OpenClaw required directories
RUN mkdir -p /home/smoltbot/.openclaw/agents/smoltbot/sessions \
    /home/smoltbot/.openclaw/credentials \
    /home/smoltbot/.openclaw/workspace \
    && chmod 700 /home/smoltbot/.openclaw \
    && chown -R smoltbot:smoltbot /home/smoltbot/.openclaw

# Copy OpenClaw configuration
COPY --chown=smoltbot:smoltbot deploy/openclaw.json /home/smoltbot/.openclaw/openclaw.json

# Copy startup script
COPY --chown=smoltbot:smoltbot deploy/start.sh /home/smoltbot/start.sh
RUN chmod +x /home/smoltbot/start.sh

# Note: NOT switching to smoltbot user here - start.sh handles user switching
# after starting Tailscale (which requires root)

# Environment variables (set via fly secrets)
# SMOLTBOT_API_URL - Supabase URL
# SMOLTBOT_API_KEY - Supabase service key
# ANTHROPIC_API_KEY - For Claude

EXPOSE 18789

CMD ["/home/smoltbot/start.sh"]
