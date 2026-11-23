import OpenAI from 'openai';
import type { ChatProviderInput } from './chat-handler';
import { ChatFailure } from './chat-security';
import {
  MAX_CHAT_TOOL_ARGUMENT_BYTES, MAX_CHAT_TOOL_CALLS, type ChatProviderEvent, type ChatToolCall,
} from './chat-provider-contract';

const unavailable = () => new ChatFailure('chat_unavailable', 503, 30);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export async function openRouterProvider({ messages, config, signal, tools }: ChatProviderInput): Promise<AsyncIterable<ChatProviderEvent>> {
  signal.throwIfAborted();
  const client = new OpenAI({
    apiKey: config.apiKey, baseURL: 'https://openrouter.ai/api/v1',
    timeout: config.providerTimeoutMs, maxRetries: 0, logLevel: 'off',
    defaultHeaders: { 'HTTP-Referer': config.origin, 'X-Title': 'Akrasia Studio' },
  });
  const stream = await client.chat.completions.create({
    model: '~deepseek/deepseek-v4-flash-latest', messages,
    max_tokens: config.maxOutputTokens, temperature: 0.7, stream: true,
    // The parser below enforces one tool call locally. Omit the optional
    // provider-specific parallel_tool_calls parameter.
    ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
    // No provider fallbacks: a single app admission corresponds to one SDK request.
    ...{ provider: { allow_fallbacks: false, ...(tools?.length ? { require_parameters: true } : {}) }, reasoning: { enabled: false } },
  }, { signal, timeout: config.providerTimeoutMs, maxRetries: 0 });
  return (async function* () {
    let terminal: string | null = null;
    let call: ChatToolCall | null = null;
    let functionType = false;
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted();
        if (!Array.isArray(chunk.choices) || chunk.choices.length > 1) throw unavailable();
        const choice = chunk.choices[0];
        // OpenAI may emit an empty usage frame; OpenRouter repeats the terminal
        // reason in a content-free usage frame. Neither frame is a new action.
        if (!choice) {
          if (!chunk.usage) throw unavailable();
          continue;
        }
        if (!record(choice.delta) || (choice.index !== undefined && choice.index !== 0)) throw unavailable();
        const delta = choice.delta;
        const content = delta.content;
        if (content !== undefined && content !== null && typeof content !== 'string') throw unavailable();
        if (delta.role !== undefined && delta.role !== 'assistant') throw unavailable();
        if (delta.function_call !== undefined && delta.function_call !== null) throw unavailable();
        const fragments = delta.tool_calls;
        if (terminal) {
          if (!chunk.usage || choice.finish_reason !== terminal || content || fragments !== undefined) throw unavailable();
          continue;
        }
        if (fragments !== undefined) {
          if (!tools?.length || !Array.isArray(fragments) || !fragments.length || fragments.length > MAX_CHAT_TOOL_CALLS) throw unavailable();
          for (const fragment of fragments) {
            if (!record(fragment) || fragment.index !== 0 || (fragment.type !== undefined && fragment.type !== 'function')) throw unavailable();
            if (!call) call = { type: 'tool_call', id: '', name: '', arguments: '' };
            if (fragment.type === 'function') functionType = true;
            if (fragment.id !== undefined) {
              if (typeof fragment.id !== 'string' || !fragment.id || fragment.id.length > 200 || (call.id && fragment.id !== call.id)) throw unavailable();
              call.id = fragment.id;
            }
            if (fragment.function !== undefined) {
              if (!record(fragment.function)) throw unavailable();
              for (const key of ['name', 'arguments'] as const) {
                const value = fragment.function[key];
                if (value !== undefined) {
                  if (typeof value !== 'string') throw unavailable();
                  call[key] += value;
                }
              }
            }
            if (call.name.length > 64 || Buffer.byteLength(call.arguments, 'utf8') > Math.min(MAX_CHAT_TOOL_ARGUMENT_BYTES, config.maxOutputTokens * 16)) throw unavailable();
          }
        }
        if (content) yield content;
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          if (!['stop', 'length', 'tool_calls'].includes(choice.finish_reason)) throw unavailable();
          if (choice.finish_reason === 'tool_calls') {
            if (!call || !functionType || !call.id || !call.name || !call.arguments.trim()) throw unavailable();
          } else if (call) throw unavailable();
          terminal = choice.finish_reason;
        }
      }
      signal.throwIfAborted();
      // The SDK accepts a clean EOF without [DONE]. A provider terminal reason
      // is required before persistence/notifications or our own [DONE].
      if (!terminal) throw unavailable();
      // Never yield executable metadata from a partial prefix or terminal frame
      // alone: later stream errors must also prevent action handling.
      if (terminal === 'tool_calls' && call) yield call;
    } finally { stream.controller.abort(); }
  })();
}
