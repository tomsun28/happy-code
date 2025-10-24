import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigManager } from './config';
import { Logger } from './logger';
import { SessionManager } from './session';
import { ToolRegistry } from './tools';
import { ChatInterface } from './chat';

export class HappyCodeApp {
  private program: Command;
  private config: ConfigManager;
  private logger: Logger;
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private chatInterface: ChatInterface;

  constructor() {
    this.config = new ConfigManager();
    this.logger = new Logger(this.config.getConfig());
    this.sessionManager = new SessionManager();
    this.toolRegistry = new ToolRegistry(this.config, this.logger);
    this.chatInterface = new ChatInterface(this.config, this.logger, this.sessionManager, this.toolRegistry);

    this.program = new Command();
    this.setupCommands();
  }

  private setupCommands(): void {

    this.program
      .name('happy')
      .description('A simplified AI-powered CLI tool for intelligent code operations')
      .version('1.0.0');

    this.program
      .description('Start interactive chat session')
      .option('-m, --message <message>', 'Send a single message and exit')
      .action(async (options) => {
        await this.handleChatCommand(options);
      });

    this.program
      .command('todo')
      .description('Manage todos')
      .option('-a, --add <task>', 'Add new todo')
      .option('-l, --list', 'List todos')
      .option('-c, --complete <id>', 'Mark todo as complete')
      .option('-d, --delete <id>', 'Delete todo')
      .action(async (options) => {
        await this.handleTodoCommand(options);
      });

    // Configuration
    this.program
      .command('config')
      .description('Manage configuration')
      .option('-s, --set <key=value>', 'Set configuration value')
      .option('-g, --get <key>', 'Get configuration value')
      .option('--set-key <service>', 'Set API key (openai/anthropic/zhipu)')
      .action(async (options) => {
        await this.handleConfigCommand(options);
      });

    // Status command
    this.program
      .command('status')
      .description('Show current status and session information')
      .action(async () => {
        await this.handleStatusCommand();
      });
  }

  private async handleChatCommand(options: any): Promise<void> {
    if (options.message) {
      await this.chatInterface.sendMessage(options.message);
    } else {
      await this.chatInterface.startInteractiveMode();
    }
  }

  private async handleTodoCommand(options: any): Promise<void> {
    try {
      if (options.add) {
        const todoId = this.sessionManager.addTodo({
          content: options.add,
          status: 'pending',
          activeForm: `Adding "${options.add}"`
        });
        this.logger.success(`Added todo: ${todoId}`);
      } else if (options.list) {
        const todos = this.sessionManager.getTodos();
        if (todos.length === 0) {
          console.log(chalk.yellow('No todos found'));
        } else {
          console.log(chalk.green('Current todos:'));
          todos.forEach(todo => {
            const status = todo.status === 'completed' ? '✓' :
                          todo.status === 'in_progress' ? '→' : '○';
            console.log(`  ${status} [${todo.id.substring(0, 8)}] ${todo.content}`);
          });
        }
      } else if (options.complete) {
        this.sessionManager.updateTodo(options.complete, {
          status: 'completed',
          activeForm: 'Completed'
        });
        this.logger.success(`Marked todo as complete: ${options.complete}`);
      } else if (options.delete) {
        this.sessionManager.deleteTodo(options.delete);
        this.logger.success(`Deleted todo: ${options.delete}`);
      } else {
        const todos = this.sessionManager.getTodos();
        if (todos.length === 0) {
          console.log(chalk.yellow('No todos found. Use --add to create a new todo.'));
        } else {
          console.log(chalk.green('Current todos:'));
          todos.forEach(todo => {
            const status = todo.status === 'completed' ? '✓' :
                          todo.status === 'in_progress' ? '→' : '○';
            console.log(`  ${status} [${todo.id.substring(0, 8)}] ${todo.content}`);
          });
        }
      }
    } catch (error) {
      this.logger.error('Error managing todos', error);
    }
  }

  private async handleConfigCommand(options: any): Promise<void> {
    try {
      if (options.set) {
        const [key, value] = options.set.split('=');
        if (!key || !value) {
          console.error(chalk.red('Invalid format. Use: key=value'));
          return;
        }

        // This would need more sophisticated handling for nested config
        this.logger.info(`Setting ${key} = ${value}`);
        this.config.updateConfig({ [key]: value } as any);
        this.logger.success('Configuration updated');
      } else if (options.get) {
        const config = this.config.getConfig();
        const value = (config as any)[options.get];
        console.log(`${options.get} = ${value}`);
      } else if (options.setKey) {
        const answer = await inquirer.prompt([
          {
            type: 'password',
            name: 'apiKey',
            message: `Enter ${options.setKey} API key:`
          }
        ]);

        this.config.setApiKey(options.setKey as 'openai' | 'anthropic' | 'zhipu', answer.apiKey);
        this.logger.success(`${options.setKey} API key updated`);
      } else {
        const config = this.config.getConfig();
        console.log(chalk.green('Current configuration:'));
        console.log(JSON.stringify(config, null, 2));
      }
    } catch (error) {
      this.logger.error('Error managing configuration', error);
    }
  }

  private async handleStatusCommand(): Promise<void> {
    try {
      const session = this.sessionManager.getCurrentSession();

      console.log(chalk.green.bold('Happy Code CLI Status'));
      console.log(chalk.gray('─'.repeat(40)));

      if (session) {
        console.log(`Session ID: ${chalk.cyan(session.id.substring(0, 8))}`);
        console.log(`Started: ${chalk.gray(session.startTime.toLocaleString())}`);
        console.log(`Messages: ${chalk.yellow(session.messages.length)}`);
        console.log(`Todos: ${chalk.yellow(session.todos.length)}`);

        const inProgressTodos = session.todos.filter(t => t.status === 'in_progress');
        if (inProgressTodos.length > 0) {
          console.log(`Currently working on: ${chalk.blue(inProgressTodos[0].activeForm)}`);
        }
      } else {
        console.log(chalk.yellow('No active session'));
        console.log(chalk.gray('Use "happy chat" to start a new session'));
      }

      const config = this.config.getConfig();
      console.log(`\nEnvironment: ${chalk.cyan(config.environment)}`);
      console.log(`Log Level: ${chalk.cyan(config.logLevel)}`);

      if (config.apiKeys.openai || config.apiKeys.anthropic || config.apiKeys.zhipu) {
        console.log(`API Keys: ${chalk.green('configured')}`);
        const providers = [];
        if (config.apiKeys.openai) providers.push('OpenAI');
        if (config.apiKeys.anthropic) providers.push('Anthropic');
        if (config.apiKeys.zhipu) providers.push('Z.ai');
        console.log(`  Providers: ${providers.join(', ')}`);
        console.log(`  Default: ${chalk.cyan(config.defaults.aiProvider)} (${config.defaults.aiModel})`);
      } else {
        console.log(`API Keys: ${chalk.yellow('not configured')}`);
      }
    } catch (error) {
      this.logger.error('Error getting status', error);
    }
  }

  public async run(argv?: string[]): Promise<void> {
    try {
      // Load environment variables
      require('dotenv').config();

      // Create a session if none exists
      if (!this.sessionManager.getCurrentSession()) {
        this.sessionManager.createSession();
      }

      await this.program.parseAsync(argv);
    } catch (error) {
      this.logger.error('Application error', error);
      process.exit(1);
    }
  }
}