#!/bin/bash
set -e

# Start Tailscale (requires root)
echo "Starting Tailscale..."
tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &

# Wait for tailscaled to be ready
sleep 2

# Authenticate with Tailscale
if [ -n "$TAILSCALE_AUTHKEY" ]; then
  echo "Authenticating with Tailscale..."
  tailscale --socket=/var/run/tailscale/tailscaled.sock up --authkey="${TAILSCALE_AUTHKEY}" --hostname=smoltbot
  echo "Tailscale connected. IP: $(tailscale --socket=/var/run/tailscale/tailscaled.sock ip -4)"
else
  echo "Warning: TAILSCALE_AUTHKEY not set, skipping Tailscale setup"
fi

# Export env vars that need to pass through to smoltbot user
export SMOLTBOT_API_URL SMOLTBOT_API_KEY SMOLTBOT_ENABLED SMOLTBOT_BATCH_SIZE
export ANTHROPIC_API_KEY OPENCLAW_GATEWAY_TOKEN

# Run the rest as smoltbot user with proper HOME
exec runuser -u smoltbot -- /bin/bash -c '
set -e
cd /home/smoltbot

# Initialize smoltbot if not already done
if [ ! -f /home/smoltbot/.smoltbot/config.json ]; then
  echo "Initializing smoltbot..."
  cd /home/smoltbot/plugin && node dist/bin/smoltbot.js init
fi

# Show status
echo "Smoltbot status:"
cd /home/smoltbot/plugin && node dist/bin/smoltbot.js status

# Validate OpenClaw config
echo "Validating OpenClaw configuration..."
openclaw doctor || true

# Start OpenClaw gateway
echo "Starting OpenClaw gateway on port 18789 (bind: lan)..."
cd /usr/local/lib/node_modules/openclaw
exec node dist/index.js gateway --allow-unconfigured --port 18789 --bind lan
'
