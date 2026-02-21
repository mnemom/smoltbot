import { describe, it, expect } from 'vitest';
import { parseSSEEvents, readStreamToText } from '../sse-parser';

describe('parseSSEEvents', () => {
  describe('Anthropic SSE format', () => {
    it('should extract thinking blocks from content_block_delta events', () => {
      const sse = [
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I should analyze this carefully."}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" Let me consider the implications."}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my response."}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":1}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'anthropic');

      expect(result.thinking).toBe('I should analyze this carefully. Let me consider the implications.');
      expect(result.text).toBe('Here is my response.');
      expect(result.toolCalls).toEqual([]);
      expect(result.rawContentBlocks).toHaveLength(2);
      expect(result.rawContentBlocks[0].type).toBe('thinking');
      expect(result.rawContentBlocks[1].type).toBe('text');
    });

    it('should extract tool calls', () => {
      const sse = [
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I need to call the tool."}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\": \\"SF\\"}"}}',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'anthropic');

      expect(result.thinking).toBe('I need to call the tool.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].input).toBe('{"location": "SF"}');
    });

    it('should return empty strings when no thinking found', () => {
      const sse = [
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Just a text response."}}',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'anthropic');

      expect(result.thinking).toBe('');
      expect(result.text).toBe('Just a text response.');
    });

    it('should handle malformed JSON lines gracefully', () => {
      const sse = [
        'data: not-valid-json',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Valid thinking."}}',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'anthropic');

      expect(result.thinking).toBe('Valid thinking.');
    });

    it('should skip [DONE] lines', () => {
      const sse = [
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'anthropic');

      expect(result.text).toBe('Hello');
    });
  });

  describe('OpenAI SSE format', () => {
    it('should extract reasoning_content as thinking', () => {
      const sse = [
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"reasoning_content":"Let me think about this."}}]}',
        '',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"reasoning_content":" I should be careful."}}]}',
        '',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"Here is my answer."}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'openai');

      expect(result.thinking).toBe('Let me think about this. I should be careful.');
      expect(result.text).toBe('Here is my answer.');
    });

    it('should extract streamed tool calls', () => {
      const sse = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search"}}]}}]}',
        '',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]}}]}',
        '',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'openai');

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.toolCalls[0].input).toBe('{"q":"test"}');
    });

    it('should return empty thinking when no reasoning_content', () => {
      const sse = [
        'data: {"choices":[{"delta":{"content":"Plain response."}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'openai');

      expect(result.thinking).toBe('');
      expect(result.text).toBe('Plain response.');
    });
  });

  describe('Gemini SSE format', () => {
    it('should extract thought parts as thinking', () => {
      const sse = [
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Analyzing the request."}]}}]}',
        '',
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":" This seems safe."}]}}]}',
        '',
        'data: {"candidates":[{"content":{"parts":[{"text":"My response."}]}}]}',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'gemini');

      expect(result.thinking).toBe('Analyzing the request. This seems safe.');
      expect(result.text).toBe('My response.');
    });

    it('should extract function calls', () => {
      const sse = [
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_data","args":{"id":"123"}}}]}}]}',
        '',
      ].join('\n');

      const result = parseSSEEvents(sse, 'gemini');

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_data');
      expect(result.toolCalls[0].input).toBe('{"id":"123"}');
    });
  });
});

describe('readStreamToText', () => {
  it('should read a ReadableStream to a string', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('Hello '));
        controller.enqueue(encoder.encode('World'));
        controller.close();
      },
    });

    const result = await readStreamToText(stream);
    expect(result).toBe('Hello World');
  });

  it('should handle empty streams', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const result = await readStreamToText(stream);
    expect(result).toBe('');
  });

  it('should handle multi-byte UTF-8', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('Thinking: '));
        controller.enqueue(encoder.encode('🤔'));
        controller.close();
      },
    });

    const result = await readStreamToText(stream);
    expect(result).toBe('Thinking: 🤔');
  });
});
