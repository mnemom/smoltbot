/**
 * SSE Stream Parser for Gateway Background Analysis
 *
 * Parses Server-Sent Events (SSE) from Anthropic, OpenAI, and Gemini streaming
 * responses into structured content blocks. Used by the gateway's tee() stream
 * interception to extract thinking blocks for real-time AIP analysis.
 */

export interface ParsedSSEResponse {
  thinking: string;
  text: string;
  toolCalls: Array<{ name: string; input: string }>;
  rawContentBlocks: Array<{ type: string; content: string }>;
}

/**
 * Read a tee'd ReadableStream to completion and return the full text.
 */
export async function readStreamToText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    // Flush any remaining bytes
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }

  return chunks.join('');
}

/**
 * Parse accumulated SSE text into structured response data.
 * Supports Anthropic, OpenAI, and Gemini SSE formats.
 */
export function parseSSEEvents(sseText: string, provider: string): ParsedSSEResponse {
  if (provider === 'openai') {
    return parseOpenAISSE(sseText);
  }
  if (provider === 'gemini') {
    return parseGeminiSSE(sseText);
  }
  // Default: Anthropic
  return parseAnthropicSSE(sseText);
}

/**
 * Parse Anthropic SSE format.
 * Events: content_block_start, content_block_delta, content_block_stop
 * Delta types: thinking_delta, text_delta, input_json_delta
 */
function parseAnthropicSSE(body: string): ParsedSSEResponse {
  const blocks: Map<number, { type: string; content: string; name?: string; input?: string }> = new Map();

  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(jsonStr);
    } catch {
      continue;
    }

    const eventType = event.type as string;

    if (eventType === 'content_block_start') {
      const index = event.index as number;
      const block = event.content_block as Record<string, unknown>;
      blocks.set(index, {
        type: block.type as string,
        content: '',
        name: block.name as string | undefined,
        input: '',
      });
    } else if (eventType === 'content_block_delta') {
      const index = event.index as number;
      const delta = event.delta as Record<string, unknown>;
      const existing = blocks.get(index);
      if (!existing) continue;

      if (delta.type === 'thinking_delta') {
        existing.content += (delta.thinking as string) || '';
      } else if (delta.type === 'text_delta') {
        existing.content += (delta.text as string) || '';
      } else if (delta.type === 'input_json_delta') {
        existing.input = (existing.input || '') + ((delta.partial_json as string) || '');
      }
    }
  }

  return extractFromBlocks(blocks);
}

/**
 * Parse OpenAI SSE format.
 * Events: choices[0].delta with content, reasoning_content, tool_calls
 */
function parseOpenAISSE(body: string): ParsedSSEResponse {
  let contentAccum = '';
  let reasoningAccum = '';
  const toolCallsMap: Map<number, { name: string; arguments: string }> = new Map();

  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(jsonStr);
    } catch {
      continue;
    }

    const choices = event.choices as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(choices) || choices.length === 0) continue;

    const delta = choices[0].delta as Record<string, unknown> | undefined;
    if (!delta) continue;

    if (typeof delta.content === 'string') {
      contentAccum += delta.content;
    }
    if (typeof delta.reasoning_content === 'string') {
      reasoningAccum += delta.reasoning_content;
    }

    const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(deltaToolCalls)) {
      for (const dtc of deltaToolCalls) {
        const idx = (dtc.index as number) ?? 0;
        const fn = dtc.function as Record<string, unknown> | undefined;
        if (!fn) continue;
        const existing = toolCallsMap.get(idx);
        if (!existing) {
          toolCallsMap.set(idx, {
            name: (fn.name as string) || '',
            arguments: (fn.arguments as string) || '',
          });
        } else {
          if (fn.name) existing.name += fn.name as string;
          if (fn.arguments) existing.arguments += fn.arguments as string;
        }
      }
    }
  }

  const toolCalls: Array<{ name: string; input: string }> = [];
  for (const tc of toolCallsMap.values()) {
    if (tc.name) {
      toolCalls.push({ name: tc.name, input: tc.arguments || '{}' });
    }
  }

  const rawContentBlocks: Array<{ type: string; content: string }> = [];
  if (reasoningAccum) rawContentBlocks.push({ type: 'thinking', content: reasoningAccum });
  if (contentAccum) rawContentBlocks.push({ type: 'text', content: contentAccum });
  for (const tc of toolCalls) {
    rawContentBlocks.push({ type: 'tool_use', content: tc.input });
  }

  return {
    thinking: reasoningAccum,
    text: contentAccum,
    toolCalls,
    rawContentBlocks,
  };
}

/**
 * Parse Gemini SSE format.
 * Gemini streams JSON objects with candidates[0].content.parts[]
 */
function parseGeminiSSE(body: string): ParsedSSEResponse {
  let thinkingAccum = '';
  let textAccum = '';
  const toolCalls: Array<{ name: string; input: string }> = [];

  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(jsonStr);
    } catch {
      continue;
    }

    const candidates = event.candidates as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(candidates) || candidates.length === 0) continue;

    const content = candidates[0].content as Record<string, unknown> | undefined;
    if (!content) continue;

    const parts = content.parts as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (typeof part.thought === 'boolean' && part.thought && typeof part.text === 'string') {
        thinkingAccum += part.text;
      } else if (typeof part.text === 'string') {
        textAccum += part.text;
      } else if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        toolCalls.push({
          name: (fc.name as string) || '',
          input: JSON.stringify(fc.args || {}),
        });
      }
    }
  }

  const rawContentBlocks: Array<{ type: string; content: string }> = [];
  if (thinkingAccum) rawContentBlocks.push({ type: 'thinking', content: thinkingAccum });
  if (textAccum) rawContentBlocks.push({ type: 'text', content: textAccum });
  for (const tc of toolCalls) {
    rawContentBlocks.push({ type: 'tool_use', content: tc.input });
  }

  return {
    thinking: thinkingAccum,
    text: textAccum,
    toolCalls,
    rawContentBlocks,
  };
}

/**
 * Convert accumulated Anthropic content blocks into ParsedSSEResponse.
 */
function extractFromBlocks(
  blocks: Map<number, { type: string; content: string; name?: string; input?: string }>
): ParsedSSEResponse {
  const thinkingParts: string[] = [];
  const textParts: string[] = [];
  const toolCalls: Array<{ name: string; input: string }> = [];
  const rawContentBlocks: Array<{ type: string; content: string }> = [];

  for (const block of blocks.values()) {
    if (block.type === 'thinking') {
      thinkingParts.push(block.content);
      rawContentBlocks.push({ type: 'thinking', content: block.content });
    } else if (block.type === 'tool_use') {
      toolCalls.push({ name: block.name || '', input: block.input || '{}' });
      rawContentBlocks.push({ type: 'tool_use', content: block.input || '{}' });
    } else {
      textParts.push(block.content);
      rawContentBlocks.push({ type: 'text', content: block.content });
    }
  }

  return {
    thinking: thinkingParts.join('\n\n---\n\n'),
    text: textParts.join('\n\n'),
    toolCalls,
    rawContentBlocks,
  };
}
