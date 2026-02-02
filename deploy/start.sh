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

# Run the rest as smoltbot user (preserve environment with -m)
exec su -m smoltbot -c '
set -e

# Initialize smoltbot if not already done
if [ ! -f ~/.smoltbot/config.json ]; then
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
# --bind lan: Binds to 0.0.0.0 so Fly proxy can reach the gateway
# OPENCLAW_GATEWAY_TOKEN is read from environment (set via fly secrets)
# See https://docs.openclaw.ai/platforms/fly
echo "Starting OpenClaw gateway on port 18789 (bind: lan)..."
cd /usr/local/lib/node_modules/openclaw
exec node dist/index.js gateway --allow-unconfigured --port 18789 --bind lan
'
