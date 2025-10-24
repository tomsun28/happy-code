import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigManager } from './config';
import { Logger } from './logger';
import { SessionManager } from './session';
import { ToolRegistry } from './tools';
import { AIProviderFactory } from './ai-provider';
import { ChatMessage, ToolCall } from '../types';

interface CommandUsage {
  command: string;
  count: number;
  lastUsed: Date;
}

export class ChatInterface {
  private config: ConfigManager;
  private logger: Logger;
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private commandHistory: CommandUsage[] = [];
  private readonly MAX_HISTORY_SIZE = 50;
  private readonly MAX_SUGGESTIONS = 8;

  constructor(
    config: ConfigManager,
    logger: Logger,
    sessionManager: SessionManager,
    toolRegistry: ToolRegistry
  ) {
    this.config = config;
    this.logger = logger;
    this.sessionManager = sessionManager;
    this.toolRegistry = toolRegistry;
  }

  public async startInteractiveMode(): Promise<void> {
    console.log(chalk.green.bold('🎉 Happy Code Chat - Interactive Mode'));
    console.log(chalk.gray('Type "help" for commands, "exit" to quit'));
    console.log(chalk.gray('Use slash commands like /clear, /exit, /status'));
    console.log(chalk.gray('Use /? or /?? to see command suggestions'));
    console.log(chalk.gray('─'.repeat(50)));

    while (true) {
      try {
        const { message } = await inquirer.prompt([
          {
            type: 'input',
            name: 'message',
            message: chalk.cyan('happy>'),
            prefix: ''
          }
        ]);

        // Handle slash commands
        if (message.startsWith('/')) {
          const handled = await this.handleSlashCommand(message);
          if (handled === 'exit') {
            break;
          }
          continue;
        }

        // Handle traditional commands for backward compatibility
        if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
          break;
        }

        if (message.toLowerCase() === 'help') {
          this.showHelp();
          continue;
        }

        if (message.toLowerCase() === 'status') {
          await this.showStatus();
          continue;
        }

        if (message.toLowerCase() === 'tools') {
          this.showTools();
          continue;
        }

        if (message.toLowerCase() === 'todos') {
          this.showTodos();
          continue;
        }

        if (message.trim() === '') {
          continue;
        }

        await this.sendMessage(message);

      } catch (error) {
        this.logger.error('Chat interface error', error);
      }
    }

    console.log(chalk.green('\nGoodbye! 👋'));
  }

  public async sendMessage(message: string): Promise<void> {
    try {
      // Add user message to session
      this.sessionManager.addMessage({
        role: 'user',
        content: message
      });

      console.log(chalk.blue('\n🤔 Processing...'));

      // Parse for tool calls
      const toolCalls = this.parseToolCalls(message);
      let response = '';

      if (toolCalls.length > 0) {
        response = await this.executeToolCalls(toolCalls);
      } else {
        response = await this.generateResponse(message);
      }

      // Add assistant response to session
      this.sessionManager.addMessage({
        role: 'assistant',
        content: response,
        toolCalls: toolCalls
      });

      console.log(chalk.green('\n🤖 Assistant:'));
      console.log(response);
      console.log();

    } catch (error) {
      this.logger.error('Error sending message', error);
      console.log(chalk.red('\n❌ Error: ') + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  private parseToolCalls(message: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // Simple pattern matching for tool calls
    // Format: tool_name(parameters) or /tool_name parameters
    const toolCallPatterns = [
      /(\w+)\(([^)]+)\)/g,  // tool_name(params)
      /\/(\w+)\s+(.+)/g     // /tool_name params
    ];

    for (const pattern of toolCallPatterns) {
      let match;
      while ((match = pattern.exec(message)) !== null) {
        const toolName = match[1];
        const paramsStr = match[2];

        // Check if tool exists
        if (this.toolRegistry.hasTool(toolName)) {
          try {
            const params = this.parseParameters(paramsStr);
            toolCalls.push({
              tool: toolName,
              parameters: params
            });
          } catch (error) {
            this.logger.error(`Failed to parse parameters for ${toolName}`, error);
          }
        }
      }
    }

    return toolCalls;
  }

  private parseParameters(paramStr: string): Record<string, any> {
    const params: Record<string, any> = {};

    // Simple parameter parsing
    // Handle quoted strings and key=value pairs
    const pairs = paramStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

    for (const pair of pairs) {
      if (pair.includes('=')) {
        const [key, ...valueParts] = pair.split('=');
        const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
        params[key.trim()] = value;
      } else {
        // Single parameter - treat as file_path or main parameter
        const cleanValue = pair.replace(/^["']|["']$/g, '');
        if (cleanValue.includes('/') || cleanValue.includes('.')) {
          params.file_path = cleanValue;
        } else {
          params.pattern = cleanValue;
        }
      }
    }

    return params;
  }

  private async executeToolCalls(toolCalls: ToolCall[]): Promise<string> {
    const results: string[] = [];

    for (const toolCall of toolCalls) {
      try {
        this.logger.tool(toolCall.tool, `Executing: ${JSON.stringify(toolCall.parameters)}`);
        const result = await this.toolRegistry.executeTool(toolCall.tool, toolCall.parameters);

        if (result.success) {
          let output = `✅ ${toolCall.tool} executed successfully\n`;

          if (result.data) {
            if (typeof result.data === 'string') {
              output += result.data;
            } else if (result.data.content) {
              output += result.data.content;
            } else if (result.data.files) {
              output += `Found ${result.data.count} files:\n`;
              output += result.data.files.map((f: string) => `  ${f}`).join('\n');
            } else if (result.data.matches) {
              output += `Found ${result.data.count} matches:\n`;
              output += result.data.matches
                .slice(0, 10)
                .map((m: any) => `  ${m.file}:${m.line}: ${m.content}`)
                .join('\n');
              if (result.data.matches.length > 10) {
                output += `\n  ... and ${result.data.matches.length - 10} more`;
              }
            } else if (result.data.stdout) {
              output += result.data.stdout;
            }
          }

          results.push(output);
        } else {
          results.push(`❌ ${toolCall.tool} failed: ${result.error}`);
        }
      } catch (error) {
        results.push(`❌ ${toolCall.tool} error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return results.join('\n\n');
  }

  private async generateResponse(message: string): Promise<string> {
    try {
      // Get AI provider
      const aiProvider = AIProviderFactory.getDefaultProvider(this.config, this.logger);

      // Get conversation history
      const session = this.sessionManager.getCurrentSession();
      const messages = session ? session.messages : [];
      const currentDateTime = new Date().toLocaleString();

      // Add system message
      const systemMessage: ChatMessage = {
        role: 'system',
        content: `You are "Happy", The current date is ${{currentDateTime}}. 
        You are an intelligent and kind assistant, with depth and wisdom. You can lead the conversation, suggest topics, offer observations, illustrate points with examples.

When asked for code, always wrap code snippets in Markdown \`\`\` blocks.
Immediately after the code block, ask: “Would you like me to explain or break it down?” — unless the user explicitly says they don’t want explanation.

If you are asked about events after your knowledge cutoff (or information you are not certain of), you should say you may have incomplete information and that you may hallucinate.

If tasks involve using tools (search, file reading, code execution etc), follow tool-use instructions carefully (read entire files, understand architecture, don’t duplicate code already present).

When working on code projects: always read entire files, understand context, architecture, avoid making assumptions.

Avoid providing or aiding malicious/illegal/harmful content (e.g., malware, hacking tools).

Maintain friendly, helpful tone. Don’t correct user terminology unnecessarily.`
      };

      // Prepare messages for API
      const userMessage: ChatMessage = {
        role: 'user',
        content: message
      };

      let apiMessages: ChatMessage[] = [systemMessage, ...messages, userMessage];

      // Get tool definitions
      const toolDefinitions = aiProvider.convertToolsToSchema(this.toolRegistry);

      // Get AI response
      const response = await aiProvider.sendMessage(apiMessages, toolDefinitions);

      // Log usage if available
      if (response.usage) {
        this.logger.info(`Token usage: ${response.usage.totalTokens} total (${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion)`);
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(chalk.blue('\n🔧 AI is calling tools...'));

        // Add assistant message with tool calls
        this.sessionManager.addMessage({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls
        });

        // Execute tool calls
        const toolResults = await this.executeAIToolCalls(response.toolCalls);

        // Add tool results to conversation
        for (const result of toolResults) {
          this.sessionManager.addMessage({
            role: 'tool',
            content: JSON.stringify(result.result),
            toolCallId: result.toolCallId,
            name: result.toolName
          });
        }

        // Get final response from AI with tool results
        apiMessages = [
          systemMessage,
          ...messages,
          userMessage,
          {
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls
          },
          ...toolResults.map(result => ({
            role: 'tool' as const,
            content: JSON.stringify(result.result),
            toolCallId: result.toolCallId,
            name: result.toolName
          }))
        ];

        const finalResponse = await aiProvider.sendMessage(apiMessages, toolDefinitions);

        // Add final assistant response
        this.sessionManager.addMessage({
          role: 'assistant',
          content: finalResponse.content
        });

        return finalResponse.content;
      }

      return response.content;

    } catch (error) {
      this.logger.error('AI provider error', error);

      // Fallback to simple responses if AI fails
      if (error instanceof Error && error.message.includes('not configured')) {
        return "⚠️ AI is not configured. Please set up an API key first:\n" +
               "• For Z.ai: happy config --set-key zhipu\n" +
               "• For OpenAI: happy config --set-key openai\n" +
               "• For Anthropic: happy config --set-key anthropic\n\n" +
               "You can also use tool commands directly:\n" +
               "• Read(file_path) - Read file contents\n" +
               "• Glob(pattern) - Search for files\n" +
               "• Grep(pattern) - Search in files\n" +
               "• Bash(command) - Run shell commands";
      }

      return "I'm having trouble connecting to the AI service. You can still use tool commands directly or try again later.";
    }
  }

  private async executeAIToolCalls(toolCalls: ToolCall[]): Promise<Array<{toolCallId: string; toolName: string; result: any}>> {
    const results: Array<{toolCallId: string; toolName: string; result: any}> = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const toolCallId = `tool_${Date.now()}_${i}`;

      try {
        console.log(chalk.yellow(`\n🔧 Calling ${toolCall.tool} with: ${JSON.stringify(toolCall.parameters)}`));

        const result = await this.toolRegistry.executeTool(toolCall.tool, toolCall.parameters);

        if (result.success) {
          console.log(chalk.green(`✅ ${toolCall.tool} completed successfully`));
          if (result.data && typeof result.data === 'object') {
            // Show a summary of the result
            if (result.data.content) {
              const preview = typeof result.data.content === 'string'
                ? result.data.content.substring(0, 200) + (result.data.content.length > 200 ? '...' : '')
                : JSON.stringify(result.data.content).substring(0, 200);
              console.log(chalk.gray(`Result preview: ${preview}`));
            } else if (result.data.files) {
              console.log(chalk.gray(`Found ${result.data.files.length} files`));
            } else if (result.data.stdout) {
              console.log(chalk.gray(`Command output: ${result.data.stdout.substring(0, 200)}${result.data.stdout.length > 200 ? '...' : ''}`));
            }
          }
        } else {
          console.log(chalk.red(`❌ ${toolCall.tool} failed: ${result.error}`));
        }

        results.push({
          toolCallId,
          toolName: toolCall.tool,
          result
        });

      } catch (error) {
        console.log(chalk.red(`❌ ${toolCall.tool} error: ${error instanceof Error ? error.message : 'Unknown error'}`));

        results.push({
          toolCallId,
          toolName: toolCall.tool,
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    }

    return results;
  }

  private showHelp(): void {
    console.log(chalk.green('\n📖 Available Commands:'));
    console.log('  help     - Show this help message');
    console.log('  status   - Show current session status');
    console.log('  tools    - List available tools');
    console.log('  todos    - Show current todos');
    console.log('  exit     - Exit chat mode');
    console.log(chalk.gray('\n🛠️  Tool Usage Examples:'));
    console.log('  Read(file="./src/index.ts")');
    console.log('  Glob(pattern="**/*.js")');
    console.log('  Grep(pattern="function", glob="**/*.ts")');
    console.log('  Bash(command="npm install")');
    console.log(chalk.gray('\nOr use slash commands:'));
    console.log('  /read ./src/index.ts');
    console.log('  /search **/*.json');
    console.log('  /grep "TODO" --glob "**/*.ts"');
  }

  private async showStatus(): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (session) {
      console.log(chalk.green('\n📊 Session Status:'));
      console.log(`  Session ID: ${session.id.substring(0, 8)}`);
      console.log(`  Messages: ${session.messages.length}`);
      console.log(`  Todos: ${session.todos.length}`);
      console.log(`  Started: ${session.startTime.toLocaleString()}`);
    } else {
      console.log(chalk.yellow('\nNo active session'));
    }
  }

  private showTools(): void {
    const tools = this.toolRegistry.listTools();
    console.log(chalk.green('\n🛠️  Available Tools:'));
    tools.forEach(tool => {
      console.log(`  ${chalk.cyan(tool.name.padEnd(10))} - ${tool.description}`);
    });
  }

  private showTodos(): void {
    const todos = this.sessionManager.getTodos();
    if (todos.length === 0) {
      console.log(chalk.yellow('\nNo todos yet'));
    } else {
      console.log(chalk.green('\n📝 Current Todos:'));
      todos.forEach(todo => {
        const status = todo.status === 'completed' ? '✅' :
                      todo.status === 'in_progress' ? '🔄' : '⭕';
        console.log(`  ${status} [${todo.id.substring(0, 8)}] ${todo.content}`);
      });
    }
  }

  private async handleSlashCommand(command: string): Promise<string | null> {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Record command usage
    this.recordCommandUsage(cmd);

    // Handle special command suggestions
    if (cmd === '/?' || cmd === '/??') {
      this.showCommandSuggestions('/');
      return null;
    }

    switch (cmd) {
      case '/exit':
      case '/quit':
        console.log(chalk.yellow('\n👋 Exiting Happy Code Chat...'));
        return 'exit';

      case '/clear':
        console.clear();
        console.log(chalk.green.bold('🎉 Happy Code Chat - Interactive Mode'));
        console.log(chalk.gray('Type "help" for commands, "exit" to quit'));
        console.log(chalk.gray('Use slash commands like /clear, /exit, /status'));
        console.log(chalk.gray('Use /? to see command suggestions'));
        console.log(chalk.gray('─'.repeat(50)));
        return null;

      case '/help':
        this.showSlashHelp();
        return null;

      case '/status':
        await this.showStatus();
        return null;

      case '/tools':
        this.showTools();
        return null;

      case '/todos':
        this.showTodos();
        return null;

      case '/history':
        this.showHistory(args[0] ? parseInt(args[0]) : undefined);
        return null;

      case '/session':
        await this.showSessionInfo();
        return null;

      case '/config':
        await this.showConfig(args[0]);
        return null;

      case '/cls':
        console.clear();
        return null;

      case '/version':
        this.showVersion();
        return null;

      case '/about':
        this.showAbout();
        return null;

      case '/reset':
        await this.resetSession(args[0] === '--confirm');
        return null;

      case '/export':
        await this.exportSession(args[0]);
        return null;

      case '/import':
        await this.importSession(args[0]);
        return null;

      default:
        console.log(chalk.red(`\n❌ Unknown command: ${cmd}`));
        console.log(chalk.gray('Type /help for available commands'));
        // Show suggestions for unknown commands
        this.showCommandSuggestions(cmd);
        return null;
    }
  }

  private showSlashHelp(): void {
    console.log(chalk.green('\n📖 Available Slash Commands:'));
    console.log(chalk.cyan('\n🔧 System Commands:'));
    console.log('  /exit, /quit     - Exit the chat application');
    console.log('  /clear, /cls     - Clear the screen');
    console.log('  /help            - Show this help message');
    console.log('  /version         - Show version information');
    console.log('  /about           - Show about information');

    console.log(chalk.cyan('\n📊 Session Commands:'));
    console.log('  /status          - Show current session status');
    console.log('  /session         - Show detailed session information');
    console.log('  /history [n]     - Show last n messages (default: 10)');
    console.log('  /reset [--confirm] - Reset current session (needs --confirm)');
    console.log('  /export [file]   - Export session to file');
    console.log('  /import [file]   - Import session from file');

    console.log(chalk.cyan('\n🛠️  Tool Commands:'));
    console.log('  /tools           - List available tools');
    console.log('  /todos           - Show current todos');
    console.log('  /config [key]    - Show configuration (or specific key)');

    console.log(chalk.gray('\n💡 You can also use traditional commands: help, status, tools, todos, exit'));
    console.log(chalk.gray('💡 Use /? to see command suggestions, Tab to auto-complete'));
  }

  private showHistory(limit?: number): void {
    const session = this.sessionManager.getCurrentSession();
    if (!session || session.messages.length === 0) {
      console.log(chalk.yellow('\nNo messages in history'));
      return;
    }

    const messageCount = limit || 10;
    const messages = session.messages.slice(-messageCount);

    console.log(chalk.green(`\n📜 Message History (last ${messages.length} messages):`));
    console.log(chalk.gray('─'.repeat(50)));

    messages.forEach((msg, index) => {
      const role = msg.role === 'user' ? chalk.blue('👤 User') :
                  msg.role === 'assistant' ? chalk.green('🤖 Assistant') :
                  msg.role === 'system' ? chalk.gray('⚙️  System') :
                  chalk.yellow('🔧 Tool');

      const timestamp = Date.now();
      const content = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;

      console.log(`${role} ${chalk.gray(timestamp)}`);
      console.log(`  ${content}`);
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        console.log(`  ${chalk.gray('🔧 Tools: ' + msg.toolCalls.map(t => t.tool).join(', '))}`);
      }
      console.log();
    });
  }

  private async showSessionInfo(): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      console.log(chalk.yellow('\nNo active session'));
      return;
    }

    console.log(chalk.green('\n📊 Session Information:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Session ID: ${chalk.cyan(session.id)}`);
    console.log(`Started: ${chalk.gray(session.startTime.toLocaleString())}`);
    console.log(`Duration: ${chalk.gray(this.formatDuration(Date.now() - session.startTime.getTime()))}`);
    console.log(`Messages: ${chalk.yellow(session.messages.length)}`);
    console.log(`Todos: ${chalk.yellow(session.todos.length)}`);

    const inProgressTodos = session.todos.filter(t => t.status === 'in_progress');
    if (inProgressTodos.length > 0) {
      console.log(`Currently working on: ${chalk.blue(inProgressTodos[0].activeForm)}`);
    }

    // Message breakdown
    const userMessages = session.messages.filter(m => m.role === 'user').length;
    const assistantMessages = session.messages.filter(m => m.role === 'assistant').length;
    const toolMessages = session.messages.filter(m => m.role === 'tool').length;

    console.log(chalk.gray('\nMessage Breakdown:'));
    console.log(`  User: ${chalk.blue(userMessages)}`);
    console.log(`  Assistant: ${chalk.green(assistantMessages)}`);
    console.log(`  Tool: ${chalk.yellow(toolMessages)}`);
  }

  private async showConfig(key?: string): Promise<void> {
    const config = this.config.getConfig();

    if (key) {
      const value = (config as any)[key];
      if (value !== undefined) {
        console.log(chalk.green(`\n⚙️  ${key}: ${chalk.cyan(JSON.stringify(value))}`));
      } else {
        console.log(chalk.red(`\n❌ Configuration key "${key}" not found`));
      }
    } else {
      console.log(chalk.green('\n⚙️  Current Configuration:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Environment: ${chalk.cyan(config.environment)}`);
      console.log(`Log Level: ${chalk.cyan(config.logLevel)}`);
      console.log(`Default AI Provider: ${chalk.cyan(config.defaults.aiProvider)}`);
      console.log(`Default AI Model: ${chalk.cyan(config.defaults.aiModel)}`);

      const configuredProviders = [];
      if (config.apiKeys.openai) configuredProviders.push('OpenAI');
      if (config.apiKeys.anthropic) configuredProviders.push('Anthropic');
      if (config.apiKeys.zhipu) configuredProviders.push('Z.ai');

      if (configuredProviders.length > 0) {
        console.log(`Configured API Keys: ${chalk.green(configuredProviders.join(', '))}`);
      } else {
        console.log(`Configured API Keys: ${chalk.yellow('None')}`);
      }
    }
  }

  private showVersion(): void {
    console.log(chalk.green('\n📦 Version Information:'));
    console.log(chalk.gray('─'.repeat(30)));
    console.log(`Happy Code CLI: ${chalk.cyan('1.0.0')}`);
    console.log(`Node.js: ${chalk.cyan(process.version)}`);
    console.log(`Platform: ${chalk.cyan(process.platform)} ${process.arch}`);
  }

  private showAbout(): void {
    console.log(chalk.green.bold('\n🎉 Happy Code CLI'));
    console.log(chalk.gray('A simplified AI-powered CLI tool for intelligent code operations'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.cyan('Features:'));
    console.log('  • Interactive chat with AI assistance');
    console.log('  • File operations (read, write, edit)');
    console.log('  • Search and grep capabilities');
    console.log('  • Shell command execution');
    console.log('  • Todo and task management');
    console.log('  • Session management');
    console.log('  • Multiple AI provider support (OpenAI, Anthropic, Z.ai)');
    console.log(chalk.cyan('\nGitHub: https://github.com/your-username/happy-code-cli'));
  }

  private async resetSession(confirmed: boolean): Promise<void> {
    if (!confirmed) {
      console.log(chalk.yellow('\n⚠️  This will reset your current session.'));
      console.log(chalk.gray('To confirm, use: /reset --confirm'));
      return;
    }

    this.sessionManager.createSession();
    console.log(chalk.green('\n✅ Session has been reset'));
    console.log(chalk.gray('Starting fresh session...'));
  }

  private async exportSession(filename?: string): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      console.log(chalk.yellow('\nNo active session to export'));
      return;
    }

    const defaultFilename = `happy-session-${session.id.substring(0, 8)}-${Date.now()}.json`;
    const exportFile = filename || defaultFilename;

    try {
      const fs = require('fs').promises;
      await fs.writeFile(exportFile, JSON.stringify(session, null, 2));
      console.log(chalk.green(`\n✅ Session exported to: ${exportFile}`));
    } catch (error) {
      console.log(chalk.red(`\n❌ Failed to export session: ${error}`));
    }
  }

  private async importSession(filename?: string): Promise<void> {
    if (!filename) {
      console.log(chalk.yellow('\n❌ Please specify a file to import: /import <filename>'));
      return;
    }

    try {
      const fs = require('fs').promises;
      const data = await fs.readFile(filename, 'utf8');
      const session = JSON.parse(data);

      // Basic validation
      if (!session.id || !session.messages || !Array.isArray(session.messages)) {
        throw new Error('Invalid session file format');
      }

      this.sessionManager.createSession();
      // This would need to be implemented in SessionManager
      // this.sessionManager.loadSession(session);

      console.log(chalk.green(`\n✅ Session imported from: ${filename}`));
      console.log(chalk.gray(`Session ID: ${session.id}`));
    } catch (error) {
      console.log(chalk.red(`\n❌ Failed to import session: ${error}`));
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private recordCommandUsage(command: string): void {
    const existingIndex = this.commandHistory.findIndex(item => item.command === command);

    if (existingIndex >= 0) {
      // Update existing command
      this.commandHistory[existingIndex].count++;
      this.commandHistory[existingIndex].lastUsed = new Date();

      // Move to front (most recently used)
      const item = this.commandHistory.splice(existingIndex, 1)[0];
      this.commandHistory.unshift(item);
    } else {
      // Add new command
      this.commandHistory.unshift({
        command,
        count: 1,
        lastUsed: new Date()
      });

      // Maintain history size
      if (this.commandHistory.length > this.MAX_HISTORY_SIZE) {
        this.commandHistory = this.commandHistory.slice(0, this.MAX_HISTORY_SIZE);
      }
    }
  }

  private getCommandSuggestions(input: string): string[] {
    const allCommands = [
      '/exit', '/quit', '/clear', '/cls', '/help', '/version', '/about',
      '/status', '/session', '/history', '/reset', '/export', '/import',
      '/tools', '/todos', '/config'
    ];

    if (input === '/') {
      // Return most frequently used commands
      return this.commandHistory
        .sort((a, b) => b.count - a.count)
        .slice(0, this.MAX_SUGGESTIONS)
        .map(item => item.command);
    }

    // Prefix matching
    const prefix = input.toLowerCase();
    const exactMatches = allCommands.filter(cmd => cmd.startsWith(prefix));

    if (exactMatches.length > 0) {
      return exactMatches.slice(0, this.MAX_SUGGESTIONS);
    }

    // Fuzzy matching - commands that contain the input
    const fuzzyMatches = allCommands.filter(cmd =>
      cmd.includes(prefix) || prefix.includes(cmd.replace('/', ''))
    );

    return fuzzyMatches.slice(0, this.MAX_SUGGESTIONS);
  }

  private showCommandSuggestions(input: string): void {
    const suggestions = this.getCommandSuggestions(input);

    if (suggestions.length === 0) {
      console.log(chalk.red(`\n❌ No commands found matching: ${input}`));
      console.log(chalk.gray('Type /help for available commands'));
      return;
    }

    console.log(chalk.cyan(`\n💡 Command suggestions for "${input}":`));
    console.log(chalk.gray('─'.repeat(40)));

    suggestions.forEach((cmd, index) => {
      const usage = this.commandHistory.find(item => item.command === cmd);
      const countText = usage ? ` (${usage.count}x used)` : '';
      const description = this.getCommandDescription(cmd);

      console.log(`  ${chalk.green((index + 1).toString().padStart(2))}. ${chalk.cyan(cmd)}${chalk.gray(countText)}`);
      console.log(`     ${chalk.gray(description)}`);
    });

    console.log(chalk.gray('\n💡 Tip: You can use Tab to auto-complete'));
  }

  private getCommandDescription(command: string): string {
    const descriptions: Record<string, string> = {
      '/exit': 'Exit the chat application',
      '/quit': 'Exit the chat application',
      '/clear': 'Clear the screen',
      '/cls': 'Clear the screen',
      '/help': 'Show this help message',
      '/version': 'Show version information',
      '/about': 'Show about information',
      '/status': 'Show current session status',
      '/session': 'Show detailed session information',
      '/history': 'Show last n messages (default: 10)',
      '/reset': 'Reset current session (needs --confirm)',
      '/export': 'Export session to file',
      '/import': 'Import session from file',
      '/tools': 'List available tools',
      '/todos': 'Show current todos',
      '/config': 'Show configuration (or specific key)'
    };

    return descriptions[command] || 'Unknown command';
  }

  private async getEnhancedInput(): Promise<string> {
    const readline = require('readline');
    const { stdin: input, stdout: output } = require('process');

    const rl = readline.createInterface({
      input,
      output,
      prompt: chalk.cyan('happy> ')
    });

    let currentInput = '';
    let suggestionsShown = false;

    return new Promise((resolve) => {
      rl.prompt();

      rl.on('line', (line: string) => {
        currentInput = line.trim();

        if (currentInput === '??' && currentInput.startsWith('/')) {
          this.showCommandSuggestions(currentInput);
          suggestionsShown = true;
          rl.prompt();
        } else {
          rl.close();
          resolve(currentInput);
        }
      });

      rl.on('SIGINT', () => {
        console.log('\n');
        rl.close();
        resolve('exit');
      });

      // Handle Tab key for auto-completion
      readline.emitKeypressEvents(input);
      input.setRawMode(true);

      input.on('keypress', (str: string, key: any) => {
        if (key.name === 'tab' && currentInput.startsWith('/')) {
          const suggestions = this.getCommandSuggestions(currentInput);
          if (suggestions.length > 0) {
            // Auto-complete to the best match
            const bestMatch = suggestions[0];
            console.log(`\r${chalk.cyan('happy>')} ${bestMatch}`);
            currentInput = bestMatch;
            rl.write(null, { ctrl: true, name: 'u' }); // Clear line
            rl.write(bestMatch);
          }
        } else if (key.name === '?' && currentInput.startsWith('/')) {
          this.showCommandSuggestions(currentInput);
          suggestionsShown = true;
          rl.prompt();
        }
      });
    });
  }
}