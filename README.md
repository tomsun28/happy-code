# Happy Code CLI

A simplified AI-powered CLI tool for intelligent code operations, inspired by Claude Code CLI architecture. Built with Node.js and TypeScript.

## 🚀 Features

- **File Operations**: Read, write, and edit files with intelligent parsing
- **Smart Search**: Advanced file and content search with pattern matching
- **Shell Integration**: Execute commands with background processing support
- **Todo Management**: Built-in task tracking and progress management
- **Interactive Chat**: Natural language interface with tool execution
- **Configuration Management**: Flexible settings and API key management

## 📦 Installation

```bash
# Clone the repository
git clone <repository-url>
cd happy-code-cli

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Install globally
pnpm run install:global
```

## 🛠️ Usage

### Interactive Chat Mode

Start the interactive chat interface:

```bash
happy chat
# or
happy c
```

In chat mode, you can:
- Ask questions about your code
- Execute tools using natural language
- Manage todos
- Get help with available commands

### File Operations

Read a file:
```bash
happy read ./src/index.ts
happy read ./package.json --lines 10 --offset 0
```

Write content to a file:
```bash
happy write ./hello.txt --content "Hello, World!"
# or use the editor interface
happy write ./new-file.js
```

Edit a file by string replacement:
```bash
# This would need to be implemented as a separate command or through chat
happy chat -m "Edit file ./config.json replace old_value=new_value"
```

### Search Operations

Search for files:
```bash
happy search "**/*.js"
happy search "*.ts" --type ts --path ./src
```

Search for content in files:
```bash
happy grep "function" --glob "**/*.js"
happy grep "TODO" --glob "**/*.ts" --ignore-case
```

### Shell Commands

Execute shell commands:
```bash
happy run "npm install"
happy run "npm test" --timeout 300000
happy run "npm run build" --background
```

### Todo Management

Manage todos:
```bash
# Add a new todo
happy todo --add "Implement user authentication"

# List todos
happy todo --list

# Mark todo as complete
happy todo --complete <todo-id>

# Delete a todo
happy todo --delete <todo-id>
```

### Configuration

Manage configuration:
```bash
# View current configuration
happy config

# Set configuration values
happy config --set logLevel=debug

# Set API keys
happy config --set-key openai
happy config --set-key anthropic

# Get configuration value
happy config --get logLevel
```

### Status

Check current status:
```bash
happy status
```

## 💬 Chat Mode Examples

In interactive chat mode, you can use natural language commands:

```
happy> Read the package.json file
happy> Search for all TypeScript files
happy> Find all TODO comments in the codebase
happy> Run npm test
happy> Add a todo to implement the new feature
happy> Show my current todos
```

You can also use direct tool calls:

```
happy> Read(file="./src/index.ts")
happy> Glob(pattern="**/*.js")
happy> Grep(pattern="function", glob="**/*.ts")
happy> Bash(command="npm install")
```

## ⚙️ Configuration

Happy Code CLI can be configured through:

1. **Environment variables** (`.env` file):
   ```bash
   OPENAI_API_KEY=your_openai_key
   ANTHROPIC_API_KEY=your_anthropic_key
   LOG_LEVEL=info
   NODE_ENV=development
   ```

2. **Configuration file** (`~/.happy-code/config.yaml`):
   ```yaml
   apiKeys:
     openai: your_key_here
     anthropic: your_key_here
   defaults:
     encoding: utf8
     maxFileSizeMB: 10
     searchResultsLimit: 100
     shellTimeoutMs: 120000
     enableBackgroundTasks: true
   environment: development
   logLevel: info
   ```

## 🏗️ Architecture

The CLI follows a modular architecture inspired by Claude Code CLI:

```
Happy Code CLI
├── Core Engine
│   ├── Application Framework
│   ├── Configuration Management
│   ├── Session Management
│   └── Tool Registry
├── Tool Ecosystem
│   ├── File Operations (Read, Write, Edit)
│   ├── Search Tools (Glob, Grep)
│   ├── Shell Integration (Bash)
│   └── Todo Management
├── Chat Interface
│   ├── Interactive Mode
│   ├── Tool Execution
│   └── Response Generation
└── Utilities
    ├── Logging
    ├── Formatters
    └── Helpers
```

## 🛠️ Development

```bash
# Development mode with TypeScript
pnpm run dev

# Build for production
pnpm run build

# Run tests
pnpm test

# Lint code
pnpm run lint
```

## 📚 API Reference

### Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| Read | Read file contents | `file_path`, `offset`, `limit` |
| Write | Write content to file | `file_path`, `content` |
| Edit | Edit file by replacement | `file_path`, `old_string`, `new_string` |
| Glob | Search for files | `pattern`, `path`, `type` |
| Grep | Search in files | `pattern`, `glob`, `case_insensitive` |
| Bash | Execute shell commands | `command`, `timeout`, `run_in_background` |

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `encoding` | string | `utf8` | Default file encoding |
| `maxFileSizeMB` | number | `10` | Maximum file size limit |
| `searchResultsLimit` | number | `100` | Maximum search results |
| `shellTimeoutMs` | number | `120000` | Shell command timeout |
| `enableBackgroundTasks` | boolean | `true` | Enable background processes |
| `logLevel` | string | `info` | Logging level |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🔮 Future Enhancements

- [ ] AI integration with OpenAI/Anthropic
- [ ] Plugin system
- [ ] Advanced file analysis
- [ ] Git integration
- [ ] Project templates
- [ ] Web interface
- [ ] Multi-language support

## 🐛 Troubleshooting

### Common Issues

1. **Permission denied**: Make sure the binary has execute permissions
2. **Command not found**: Ensure the CLI is installed globally or in your PATH
3. **Configuration errors**: Check your `~/.happy-code/config.yaml` file
4. **API key issues**: Set API keys using `happy config --set-key <service>`

### Debug Mode

Enable debug logging:
```bash
happy config --set logLevel=debug
```

## 📞 Support

For issues and questions:
- Create an issue on GitHub
- Check the documentation
- Use `happy --help` for command assistance