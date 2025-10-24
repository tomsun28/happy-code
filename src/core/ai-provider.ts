import { ChatMessage, ToolCall, ReActResponse, ReActStep } from '../types';
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

  // 带缓存的消息发送方法
  public async sendMessageWithCache(messages: ChatMessage[], tools?: AIToolDefinition[]): Promise<AIResponse> {
    // 检查是否应该使用缓存
    if (!tools && AIProviderFactory['shouldUseCache'](messages)) {
      const cached = AIProviderFactory['getCachedResponse'](messages);
      if (cached) {
        this.logger.debug('Using cached response');
        return cached;
      }
    }

    // 发送消息
    const response = await this.sendMessage(messages, tools);

    // 缓存响应（仅在没有工具调用时）
    if (!tools && AIProviderFactory['shouldUseCache'](messages)) {
      AIProviderFactory['setCachedResponse'](messages, response);
    }

    return response;
  }

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

  // 解析 ReAct 格式的响应 - 优化版本
  protected parseReActResponse(content: string): ReActResponse {
    const steps: ReActStep[] = [];
    let finalAnswer: string | undefined;

    // 首先提取 Final Answer
    const finalAnswerMatch = content.match(/Final Answer:\s*(.+?)(?=\n(?:Thought|Action|Observation)|$)/s);
    if (finalAnswerMatch) {
      finalAnswer = finalAnswerMatch[1].trim();
    }

    // 使用更精确的正则表达式，支持多行内容
    const reactPattern = /(Thought|Action|Observation):\s*([\s\S]*?)(?=\n(?:Thought|Action|Observation|Final Answer)|$)/g;
    const matches: Array<{type: string, content: string}> = [];
    
    let match;
    while ((match = reactPattern.exec(content)) !== null) {
      matches.push({
        type: match[1],
        content: match[2].trim()
      });
    }

    // 按序列组织步骤，确保 Thought -> Action -> Observation 的正确顺序
    let currentStep: Partial<ReActStep> = {};
    
    for (const item of matches) {
      switch (item.type) {
        case 'Thought':
          // 如果当前步骤已有内容，保存并开始新步骤
          if (currentStep.thought || currentStep.action) {
            if (currentStep.thought) {
              steps.push(currentStep as ReActStep);
            }
            currentStep = {};
          }
          currentStep.thought = item.content;
          break;
          
        case 'Action':
          if (currentStep.thought) {
            const actionResult = this.parseActionString(item.content);
            if (actionResult) {
              currentStep.action = actionResult;
            }
          }
          break;
          
        case 'Observation':
          if (currentStep.thought) {
            currentStep.observation = item.content;
            // 完成一个完整的步骤
            steps.push(currentStep as ReActStep);
            currentStep = {};
          }
          break;
      }
    }

    // 处理最后一个未完成的步骤
    if (currentStep.thought) {
      steps.push(currentStep as ReActStep);
    }

    // 检查是否需要更多操作
    const requiresMoreActions: boolean = !finalAnswer && 
      (steps.length === 0 || 
       (!!steps[steps.length - 1].action && !steps[steps.length - 1].observation));

    // 如果没有找到 Final Answer 但有完整的推理链，尝试从最后的 Thought 中提取
     if (!finalAnswer && steps.length > 0) {
       const lastStep = steps[steps.length - 1];
       if (lastStep.thought && !lastStep.action) {
         // 如果最后一步只有 Thought 没有 Action，可能是最终答案
         if (this.isLikelyFinalAnswer(lastStep.thought)) {
           finalAnswer = lastStep.thought;
           lastStep.finish = true;
         }
       }
     }

    return {
      steps,
      finalAnswer,
      requiresMoreActions
    };
  }

  // 解析 Action 字符串，支持多种格式
  private parseActionString(actionStr: string): {tool: string, parameters: Record<string, any>} | null {
    // 移除多余的空白字符
    actionStr = actionStr.trim();

    // 格式1: tool_call(parameters) - 特殊处理 tool_call 格式
    const toolCallMatch = actionStr.match(/^tool_call\s*\((.*)\)$/s);
    if (toolCallMatch) {
      const paramsStr = toolCallMatch[1].trim();
      
      try {
        const parameters = this.parseActionParameters(paramsStr);
        // 从参数中提取实际的工具名称
        if (parameters.command) {
          // 解析 shell 命令
          const command = parameters.command;
          const commandParts = command.split(/\s+/);
          const toolName = commandParts[0];
          
          // 构建参数对象
          const toolParams: Record<string, any> = {
            command: command
          };
          
          return { tool: 'shell', parameters: toolParams };
        }
        return null;
      } catch (error) {
        this.logger.warn(`Failed to parse tool_call parameters: ${paramsStr}`, error);
        return null;
      }
    }

    // 格式2: tool_name(parameters)
    const functionCallMatch = actionStr.match(/^(\w+)\s*\((.*)\)$/s);
    if (functionCallMatch) {
      const toolName = functionCallMatch[1];
      const paramsStr = functionCallMatch[2].trim();
      
      try {
        const parameters = this.parseActionParameters(paramsStr);
        return { tool: toolName, parameters };
      } catch (error) {
        this.logger.warn(`Failed to parse action parameters for ${toolName}: ${paramsStr}`, error);
        return null;
      }
    }

    // 格式3: tool_name with parameters on new lines
    const lines = actionStr.split('\n').map(line => line.trim()).filter(line => line);
    if (lines.length > 0) {
      const toolName = lines[0];
      if (/^\w+$/.test(toolName)) {
        const parameters: Record<string, any> = {};
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const keyValueMatch = line.match(/^(\w+):\s*(.+)$/);
          if (keyValueMatch) {
            const key = keyValueMatch[1];
            let value = keyValueMatch[2].replace(/^["']|["']$/g, '');
            parameters[key] = value;
          }
        }
        
        return { tool: toolName, parameters };
      }
    }

    return null;
  }

  // 判断是否像最终答案
  private isLikelyFinalAnswer(thought: string): boolean {
    const finalAnswerIndicators = [
      'final answer',
      '最终答案',
      'conclusion',
      '结论',
      'summary',
      '总结',
      'completed',
      '完成',
      'finished',
      '结束'
    ];

    const lowerThought = thought.toLowerCase();
    return finalAnswerIndicators.some(indicator => lowerThought.includes(indicator)) ||
           thought.length > 100; // 长文本更可能是最终答案
  }

  // 转换参数值类型
  private convertParameterValue(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;
    
    // 尝试转换为数字
    const numValue = Number(value);
    if (!isNaN(numValue) && isFinite(numValue)) {
      return numValue;
    }
    
    return value;
  }

  // 解析 Action 参数 - 增强版本
  private parseActionParameters(paramsStr: string): Record<string, any> {
    if (!paramsStr || paramsStr.trim() === '') {
      return {};
    }
    
    const params: Record<string, any> = {};
    paramsStr = paramsStr.trim();

    // 方法1: 尝试解析 JSON 格式
    if ((paramsStr.startsWith('{') && paramsStr.endsWith('}')) ||
        (paramsStr.startsWith('[') && paramsStr.endsWith(']'))) {
      try {
        return JSON.parse(paramsStr);
      } catch (error) {
        // JSON 解析失败，继续其他方法
      }
    }

    // 方法2: 解析键值对格式 (key="value", key2="value2")
    const keyValueRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g;
    let match;
    let hasKeyValue = false;

    while ((match = keyValueRegex.exec(paramsStr)) !== null) {
      const key = match[1];
      const value = match[2] || match[3] || match[4];
      params[key] = this.convertParameterValue(value);
      hasKeyValue = true;
    }

    if (hasKeyValue) {
      return params;
    }

    // 方法3: 单个值处理
    const cleanValue = paramsStr.replace(/^["']|["']$/g, '');
    
    // 根据值的特征推断参数名
    if (cleanValue.includes('/') || cleanValue.includes('.') || cleanValue.includes('\\')) {
      params.file_path = cleanValue;
    } else if (cleanValue.includes('*') || cleanValue.includes('?')) {
      params.pattern = cleanValue;
    } else if (cleanValue.startsWith('http')) {
      params.url = cleanValue;
    } else {
      // 默认作为第一个参数
      params.query = cleanValue;
    }

    return params;
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
  // 响应缓存机制
  private static responseCache = new Map<string, { response: any; timestamp: number }>();
  private static readonly CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存
  private static readonly CACHE_MAX_SIZE = 50;

  // 生成缓存键
  private static generateCacheKey(messages: ChatMessage[]): string {
    const key = messages.map(m => `${m.role}:${(m.content || '').substring(0, 100)}`).join('|');
    return Buffer.from(key).toString('base64').substring(0, 64);
  }

  // 检查缓存
  private static getCachedResponse(messages: ChatMessage[]): any | null {
    const cacheKey = this.generateCacheKey(messages);
    const cached = this.responseCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.response;
    }
    
    // 清理过期缓存
    if (cached) {
      this.responseCache.delete(cacheKey);
    }
    
    return null;
  }

  // 设置缓存
  private static setCachedResponse(messages: ChatMessage[], response: any): void {
    // 清理过期缓存
    if (this.responseCache.size >= this.CACHE_MAX_SIZE) {
      const now = Date.now();
      for (const [key, value] of this.responseCache.entries()) {
        if (now - value.timestamp > this.CACHE_TTL) {
          this.responseCache.delete(key);
        }
      }
      
      // 如果还是太多，删除最旧的
      if (this.responseCache.size >= this.CACHE_MAX_SIZE) {
        const oldestKey = this.responseCache.keys().next().value;
        if (oldestKey) {
          this.responseCache.delete(oldestKey);
        }
      }
    }
    
    const cacheKey = this.generateCacheKey(messages);
    this.responseCache.set(cacheKey, {
      response: JSON.parse(JSON.stringify(response)), // 深拷贝
      timestamp: Date.now()
    });
  }

  // 判断是否应该使用缓存
  private static shouldUseCache(messages: ChatMessage[]): boolean {
    // 不缓存包含工具调用结果的对话
    const hasToolResults = messages.some(m => m.role === 'tool');
    
    // 不缓存太长的对话
    const isTooLong = messages.length > 10;
    
    // 不缓存包含时间敏感内容的对话
    const hasTimeSensitive = messages.some(m => 
      (m.content || '').toLowerCase().includes('current') ||
      (m.content || '').toLowerCase().includes('now') ||
      (m.content || '').toLowerCase().includes('today')
    );
    
    return !hasToolResults && !isTooLong && !hasTimeSensitive;
  }

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