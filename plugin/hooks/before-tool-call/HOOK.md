---
name: smoltbot-before-tool-call
description: "Captures tool invocation intent for AAP tracing"
metadata:
  openclaw:
    emoji: "📊"
    events:
      - before_tool_call
    requires:
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

No API keys needed - traces are sent to the smoltbot proxy automatically.

## Trace Flow

```
before_tool_call → creates PendingTrace → stored by correlation_id
                                              ↓
after_tool_call  → retrieves PendingTrace → finalizes → POSTs to API
```
