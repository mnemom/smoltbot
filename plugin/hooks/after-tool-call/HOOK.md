---
name: smoltbot-after-tool-call
description: "Finalizes AAP trace with tool result and submits to API"
metadata:
  openclaw:
    emoji: "📤"
    events:
      - after_tool_call
---

# Smoltbot After Tool Call Hook

This hook runs after tool execution to:

1. Retrieve the pending trace by correlation ID
2. Calculate execution duration
3. Attach result or error information
4. Construct final AAP trace
5. Submit to trace API

## Error Handling

If the tool call resulted in an error:
- `action_type` is set to `error`
- Error message and stack are captured in metadata
- Trace is still submitted for observability

## Batching

Traces are queued and batched for efficiency:
- Flush immediately when batch size reached
- Flush after 1 second timeout
- Flush on shutdown
