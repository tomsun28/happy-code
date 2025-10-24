import { ChatMessage, ToolCall } from '../types';
import { ConfigManager } from './config';
import { Logger } from './logger';
import { ToolRegistry } from './tools';

export interface AIResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export abstract class AIProvider {
  protected config: ConfigManager;
  protected logger: Logger;

  constructor(config: ConfigManager, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  abstract sendMessage(messages: ChatMessage[], tools?: AIToolDefinition[]): Promise<AIResponse>;
  abstract isConfigured(): boolean;

  public convertToolsToSchema(toolRegistry: ToolRegistry): AIToolDefinition[] {
    const tools = toolRegistry.listTools();
    return tools.map(tool => this.createToolSchema(tool));
  }

  protected createToolSchema(tool: { name: string; description: string }): AIToolDefinition {
    // Create basic schema - can be enhanced with actual parameter schemas
    const schemas: Record<string, AIToolDefinition['input_schema']> = {
      'Read': {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to read' },
          offset: { type: 'number', description: 'Line number to start reading from (default: 0)' },
          limit: { type: 'number', description: 'Number of lines to read (default: all)' }
        },
        required: ['file_path']
      },
      'Write': {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to write' },
          content: { type: 'string', description: 'Content to write to the file' }
        },
        required: ['file_path', 'content']
      },
      'Edit': {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to edit' },
          old_string: { type: 'string', description: 'Text to replace' },
          new_string: { type: 'string', description: 'New text to insert' }
        },
        required: ['file_path', 'old_string', 'new_string']
      },
      'Glob': {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to search for files' },
          path: { type: 'string', description: 'Directory path to search in (default: current directory)' },
          type: { type: 'string', description: 'File type filter (e.g., "ts", "js")' }
        },
        required: ['pattern']
      },
      'Grep': {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for in files' },
          glob: { type: 'string', description: 'Glob pattern to filter files' },
          path: { type: 'string', description: 'Directory path to search in (default: current directory)' }
        },
        required: ['pattern']
      },
      'Bash': {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' },
          run_in_background: { type: 'boolean', description: 'Run command in background' }
        },
        required: ['command']
      }
    };

    return {
      name: tool.name,
      description: tool.description,
      input_schema: schemas[tool.name] || {
        type: 'object',
        properties: {},
        required: []
      }
    };
  }
}

export class ZhipuProvider extends AIProvider {
  private apiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

  async sendMessage(messages: ChatMessage[], tools?: AIToolDefinition[]): Promise<AIResponse> {
    const apiKey = this.config.getApiKey('zhipu');
    if (!apiKey) {
      throw new Error('Z.ai API key not configured');
    }

    const config = this.config.getConfig();

    // Convert messages for API
    const apiMessages = messages.map(msg => {
      const apiMsg: any = {
        role: msg.role === 'tool' ? 'tool' : msg.role,
        content: msg.content
      };

      if (msg.toolCallId) {
        apiMsg.tool_call_id = msg.toolCallId;
      }

      if (msg.name) {
        apiMsg.name = msg.name;
      }

      return apiMsg;
    });

    const requestBody: any = {
      model: config.defaults.aiModel,
      messages: apiMessages,
      max_tokens: config.defaults.maxTokens,
      temperature: config.defaults.temperature
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestBody.tools = tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }
      }));
      // Enable tool calls
      requestBody.tool_choice = 'auto';
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Z.ai API request failed: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();

    if (data.error) {
      throw new Error(`Z.ai API error: ${data.error.message}`);
    }

    const choice = data.choices[0];
    const toolCalls: ToolCall[] = [];

    // Parse tool calls if present
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type === 'function') {
          let parameters = toolCall.function.arguments;
          // Parse JSON string if needed
          if (typeof parameters === 'string') {
            try {
              parameters = JSON.parse(parameters);
            } catch (error) {
              this.logger.error(`Failed to parse tool parameters for ${toolCall.function.name}`, error);
              continue;
            }
          }
          toolCalls.push({
            tool: toolCall.function.name,
            parameters
          });
        }
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  }

  isConfigured(): boolean {
    return !!this.config.getApiKey('zhipu');
  }
}

export class OpenAIProvider extends AIProvider {
  private apiUrl = 'https://api.openai.com/v1/chat/completions';

  async sendMessage(messages: ChatMessage[], tools?: AIToolDefinition[]): Promise<AIResponse> {
    const apiKey = this.config.getApiKey('openai');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const config = this.config.getConfig();

    // Convert messages for API
    const apiMessages = messages.map(msg => {
      const apiMsg: any = {
        role: msg.role === 'tool' ? 'tool' : msg.role,
        content: msg.content
      };

      if (msg.toolCallId) {
        apiMsg.tool_call_id = msg.toolCallId;
      }

      if (msg.name) {
        apiMsg.name = msg.name;
      }

      return apiMsg;
    });

    const requestBody: any = {
      model: config.defaults.aiModel,
      messages: apiMessages,
      max_tokens: config.defaults.maxTokens,
      temperature: config.defaults.temperature
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestBody.tools = tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }
      }));
      // Enable tool calls
      requestBody.tool_choice = 'auto';
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();

    if (data.error) {
      throw new Error(`OpenAI API error: ${data.error.message}`);
    }

    const choice = data.choices[0];
    const toolCalls: ToolCall[] = [];

    // Parse tool calls if present
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type === 'function') {
          let parameters = toolCall.function.arguments;
          // Parse JSON string if needed
          if (typeof parameters === 'string') {
            try {
              parameters = JSON.parse(parameters);
            } catch (error) {
              this.logger.error(`Failed to parse tool parameters for ${toolCall.function.name}`, error);
              continue;
            }
          }
          toolCalls.push({
            tool: toolCall.function.name,
            parameters
          });
        }
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  }

  isConfigured(): boolean {
    return !!this.config.getApiKey('openai');
  }
}

export class AnthropicProvider extends AIProvider {
  private apiUrl = 'https://api.anthropic.com/v1/messages';

  async sendMessage(messages: ChatMessage[]): Promise<AIResponse> {
    const apiKey = this.config.getApiKey('anthropic');
    if (!apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const config = this.config.getConfig();
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.defaults.aiModel,
        max_tokens: config.defaults.maxTokens,
        temperature: config.defaults.temperature,
        messages: messages
          .filter(msg => msg.role !== 'system')
          .map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
          }))
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API request failed: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();

    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message}`);
    }

    return {
      content: data.content[0].text,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      } : undefined
    };
  }

  isConfigured(): boolean {
    return !!this.config.getApiKey('anthropic');
  }
}

export class AIProviderFactory {
  static createProvider(
    provider: 'openai' | 'anthropic' | 'zhipu',
    config: ConfigManager,
    logger: Logger
  ): AIProvider {
    switch (provider) {
      case 'zhipu':
        return new ZhipuProvider(config, logger);
      case 'openai':
        return new OpenAIProvider(config, logger);
      case 'anthropic':
        return new AnthropicProvider(config, logger);
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  static getDefaultProvider(config: ConfigManager, logger: Logger): AIProvider {
    const configData = config.getConfig();
    const provider = configData.defaults.aiProvider;

    // Try the default provider first
    let aiProvider = this.createProvider(provider, config, logger);
    if (aiProvider.isConfigured()) {
      return aiProvider;
    }

    // Fallback to any configured provider
    if (config.getApiKey('zhipu')) {
      return new ZhipuProvider(config, logger);
    }
    if (config.getApiKey('openai')) {
      return new OpenAIProvider(config, logger);
    }
    if (config.getApiKey('anthropic')) {
      return new AnthropicProvider(config, logger);
    }

    throw new Error('No AI provider is configured. Please set an API key using: happy config --set-key <provider>');
  }
}