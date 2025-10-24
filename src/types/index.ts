export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface FileOperationResult extends ToolResult {
  data?: {
    content?: string;
    lines?: string[];
    path?: string;
    size?: number;
  };
}

export interface SearchResult extends ToolResult {
  data?: {
    files?: string[];
    matches?: Array<{
      file: string;
      line: number;
      content: string;
    }>;
    count?: number;
  };
}

export interface ShellCommandResult extends ToolResult {
  data?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    executionTime?: number;
    signal?: string;
  };
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolConfig {
  timeout?: number;
  encoding?: BufferEncoding;
  maxSize?: number;
  retryAttempts?: number;
}

export interface CLIConfig {
  apiKeys: {
    openai?: string;
    anthropic?: string;
    zhipu?: string;
  };
  defaults: {
    encoding: BufferEncoding;
    maxFileSizeMB: number;
    searchResultsLimit: number;
    shellTimeoutMs: number;
    enableBackgroundTasks: boolean;
    aiProvider: 'openai' | 'anthropic' | 'zhipu';
    aiModel: string;
    maxTokens: number;
    temperature: number;
  };
  environment: 'development' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ToolInterface {
  name: string;
  description: string;
  execute(params: any, config?: ToolConfig): Promise<ToolResult>;
  validate?(params: any): boolean;
}

export interface AgentCapabilities {
  fileOperations: boolean;
  searchOperations: boolean;
  shellAccess: boolean;
  aiIntegration: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  tool: string;
  parameters: Record<string, any>;
  result?: ToolResult;
}

// ReAct 模式的数据结构
export interface ReActStep {
  thought: string;
  action?: {
    tool: string;
    parameters: Record<string, any>;
  };
  observation?: string;
  finish?: boolean;
}

export interface ReActResponse {
  steps: ReActStep[];
  finalAnswer?: string;
  requiresMoreActions: boolean;
}

export interface ReActChatMessage extends ChatMessage {
  reactData?: {
    currentStep: number;
    totalSteps: number;
    reasoningChain: string[];
  };
}

export interface Session {
  id: string;
  startTime: Date;
  messages: ChatMessage[];
  todos: TodoItem[];
  context: Record<string, any>;
}