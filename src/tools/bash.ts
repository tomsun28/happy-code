import { spawn, ChildProcess } from 'child_process';
import { ToolInterface, ToolResult, ShellCommandResult } from '../types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';

interface BackgroundProcess {
  id: string;
  process: ChildProcess;
  startTime: Date;
  command: string;
  stdout: string[];
  stderr: string[];
}

export class BashTool implements ToolInterface {
  public readonly name = 'Bash';
  public readonly description = 'Execute shell commands with optional background processing';

  private backgroundProcesses: Map<string, BackgroundProcess> = new Map();

  constructor(private config: ConfigManager, private logger: Logger) {}

  public validate(params: any): boolean {
    return params && typeof params.command === 'string';
  }

  public async execute(params: any): Promise<ShellCommandResult> {
    try {
      const {
        command,
        timeout = this.config.getConfig().defaults.shellTimeoutMs,
        run_in_background = false,
        shell_id
      } = params;

      if (shell_id) {
        return this.getBackgroundProcessOutput(shell_id);
      }

      if (run_in_background) {
        return this.executeInBackground(command);
      } else {
        return this.executeSync(command, timeout);
      }
    } catch (error) {
      this.logger.error('Error executing bash command', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error executing command'
      };
    }
  }

  private async executeSync(command: string, timeout: number): Promise<ShellCommandResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const stdout: string[] = [];
      const stderr: string[] = [];

      // Use shell for proper command parsing
      const child = spawn(command, [], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let killed = false;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        if (!killed) {
          killed = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            child.kill('SIGKILL');
          }, 5000); // Force kill after 5 seconds
        }
      }, timeout);

      // Collect stdout
      child.stdout?.on('data', (data) => {
        stdout.push(data.toString());
      });

      // Collect stderr
      child.stderr?.on('data', (data) => {
        stderr.push(data.toString());
      });

      // Handle process completion
      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);
        const executionTime = Date.now() - startTime;

        if (killed) {
          resolve({
            success: false,
            error: `Command timed out after ${timeout}ms`,
            data: {
              stdout: stdout.join(''),
              stderr: stderr.join(''),
              exitCode: -1,
              executionTime
            }
          });
        } else {
          resolve({
            success: code === 0,
            data: {
              stdout: stdout.join(''),
              stderr: stderr.join(''),
              exitCode: code || 0,
              executionTime,
              signal: signal || undefined
            },
            error: code !== 0 ? `Command exited with code ${code}` : undefined
          });
        }
      });

      // Handle process error
      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        resolve({
          success: false,
          error: error.message,
          data: {
            stdout: stdout.join(''),
            stderr: stderr.join(''),
            exitCode: -1,
            executionTime: Date.now() - startTime
          }
        });
      });
    });
  }

  private async executeInBackground(command: string): Promise<ShellCommandResult> {
    const processId = `bg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = new Date();

    const child = spawn(command, [], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env }
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    // Collect output
    child.stdout?.on('data', (data) => {
      stdout.push(data.toString());
    });

    child.stderr?.on('data', (data) => {
      stderr.push(data.toString());
    });

    // Handle process completion
    child.on('close', (code, signal) => {
      // Keep the process record but mark as completed
      const bgProcess = this.backgroundProcesses.get(processId);
      if (bgProcess) {
        bgProcess.process.emit('close', code, signal);
      }
    });

    // Handle process error
    child.on('error', (error) => {
      this.logger.error(`Background process error: ${error.message}`);
    });

    // Unref to allow parent to exit independently
    child.unref();

    const backgroundProcess: BackgroundProcess = {
      id: processId,
      process: child,
      startTime,
      command,
      stdout,
      stderr
    };

    this.backgroundProcesses.set(processId, backgroundProcess);

    return {
      success: true,
      data: {
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTime: 0
      },
      metadata: {
        process_id: processId,
        message: 'Command started in background',
        command: command
      }
    };
  }

  private async getBackgroundProcessOutput(shell_id: string): Promise<ShellCommandResult> {
    const bgProcess = this.backgroundProcesses.get(shell_id);

    if (!bgProcess) {
      return {
        success: false,
        error: `Background process not found: ${shell_id}`
      };
    }

    const runTime = Date.now() - bgProcess.startTime.getTime();

    return {
      success: true,
      data: {
        stdout: bgProcess.stdout.join(''),
        stderr: bgProcess.stderr.join(''),
        exitCode: 0, // Still running or completed successfully
        executionTime: runTime
      },
      metadata: {
        process_id: shell_id,
        command: bgProcess.command,
        start_time: bgProcess.startTime,
        running: !bgProcess.process.killed
      }
    };
  }

  public getBackgroundProcesses(): Array<{
    id: string;
    command: string;
    startTime: Date;
    running: boolean;
  }> {
    return Array.from(this.backgroundProcesses.values()).map(proc => ({
      id: proc.id,
      command: proc.command,
      startTime: proc.startTime,
      running: !proc.process.killed
    }));
  }

  public killBackgroundProcess(processId: string): boolean {
    const bgProcess = this.backgroundProcesses.get(processId);
    if (!bgProcess) {
      return false;
    }

    bgProcess.process.kill('SIGTERM');
    setTimeout(() => {
      if (!bgProcess.process.killed) {
        bgProcess.process.kill('SIGKILL');
      }
    }, 5000);

    this.backgroundProcesses.delete(processId);
    return true;
  }
}