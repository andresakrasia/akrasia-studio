/** Server-owned function descriptions sent to the provider, never client input. */
export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

/** A complete provider request is still untrusted until the action handler validates it. */
export interface ChatToolCall {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: string;
}

// String deltas preserve the existing streaming/test-provider contract.
export type ChatProviderEvent = string | ChatToolCall;

export const MAX_CHAT_TOOL_CALLS = 1;
export const MAX_CHAT_TOOL_ARGUMENT_BYTES = 4096;
