---
name: smoltbot-before-tool-call
description: "Captures tool invocation intent for AAP tracing"
metadata:
  openclaw:
    emoji: "📊"
    events:
      - before_tool_call
    requires:
      env:
        - SMOLTBOT_API_URL
        - SMOLTBOT_API_KEY
      config:
        - ~/.smoltbot/config.json
---

# Smoltbot Before Tool Call Hook

This hook intercepts tool calls before execution to:

1. Generate a unique trace ID
2. Record the tool name and parameters
3. Start timing for duration calculation
4. Store pending trace for correlation with after_tool_call

## Configuration

Requires `smoltbot init` to be run first, which creates `~/.smoltbot/config.json` with the agent ID.

Environment variables:
- `SMOLTBOT_API_URL` - Supabase project URL
- `SMOLTBOT_API_KEY` - Supabase service_role key

## Trace Flow

```
before_tool_call → creates PendingTrace → stored by correlation_id
                                              ↓
after_tool_call  → retrieves PendingTrace → finalizes → POSTs to API
```
