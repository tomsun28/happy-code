import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { ToolInterface, ToolResult, SearchResult } from '../types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export class GrepTool implements ToolInterface {
  public readonly name = 'Grep';
  public readonly description = 'Search for content patterns in files using ripgrep-style syntax';

  constructor(private config: ConfigManager, private logger: Logger) {}

  public validate(params: any): boolean {
    return params && typeof params.pattern === 'string';
  }

  public async execute(params: any): Promise<SearchResult> {
    try {
      const {
        pattern,
        path: searchPath = '.',
        glob: filePattern,
        case_insensitive = false,
        output_mode = 'files_with_matches',
        head_limit,
        context_lines = 0,
        line_numbers = true
      } = params;

      // Create regex from pattern
      const flags = case_insensitive ? 'gi' : 'g';
      const regex = new RegExp(pattern, flags);

      // Find files to search
      let files: string[];
      if (filePattern) {
        files = await glob(filePattern, {
          cwd: path.resolve(searchPath),
          absolute: true,
          nodir: true
        });
      } else {
        // Default to common source files
        const defaultPatterns = [
          '**/*.js',
          '**/*.ts',
          '**/*.jsx',
          '**/*.tsx',
          '**/*.py',
          '**/*.java',
          '**/*.cpp',
          '**/*.c',
          '**/*.cs',
          '**/*.go',
          '**/*.rs',
          '**/*.php',
          '**/*.rb',
          '**/*.swift',
          '**/*.kt',
          '**/*.scala',
          '**/*.html',
          '**/*.css',
          '**/*.scss',
          '**/*.less',
          '**/*.json',
          '**/*.xml',
          '**/*.yaml',
          '**/*.yml',
          '**/*.md',
          '**/*.txt',
          '**/*.sh',
          '**/*.bash',
          '**/*.zsh'
        ];

        const allFiles: string[] = [];
        for (const pattern of defaultPatterns) {
          try {
            const matchedFiles = await glob(pattern, {
              cwd: path.resolve(searchPath),
              absolute: true,
              nodir: true,
              ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**']
            });
            allFiles.push(...matchedFiles);
          } catch (error) {
            // Continue if pattern doesn't match
          }
        }
        files = [...new Set(allFiles)]; // Remove duplicates
      }

      const matches: GrepMatch[] = [];
      const matchedFiles = new Set<string>();

      // Search in each file
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf8');
          const lines = content.split('\n');

          let fileHasMatch = false;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = regex.exec(line);

            if (match) {
              fileHasMatch = true;
              matchedFiles.add(file);

              if (output_mode === 'content') {
                matches.push({
                  file: path.relative(process.cwd(), file),
                  line: i + 1,
                  content: line.trim()
                });
              }

              // Reset regex for next match
              regex.lastIndex = 0;

              // Apply limit if specified
              if (head_limit && matches.length >= head_limit) {
                break;
              }
            }
          }

          // Apply limit at file level if needed
          if (head_limit && matchedFiles.size >= head_limit && output_mode === 'files_with_matches') {
            break;
          }
        } catch (error) {
          // Skip files that can't be read
          this.logger.debug(`Skipping unreadable file: ${file}`);
        }
      }

      // Prepare result based on output mode
      let result: any;

      if (output_mode === 'files_with_matches') {
        result = {
          files: Array.from(matchedFiles).map(file => path.relative(process.cwd(), file)),
          count: matchedFiles.size
        };
      } else if (output_mode === 'content') {
        result = {
          matches: matches.slice(0, head_limit || Infinity),
          count: matches.length,
          files: matchedFiles.size
        };
      } else {
        result = {
          count: output_mode === 'count' ? matchedFiles.size : matches.length
        };
      }

      return {
        success: true,
        data: result,
        metadata: {
          pattern: pattern,
          case_insensitive: case_insensitive,
          searchPath: path.resolve(searchPath),
          filesSearched: files.length,
          context_lines: context_lines
        }
      };
    } catch (error) {
      this.logger.error('Error in grep search', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error in grep search'
      };
    }
  }
}