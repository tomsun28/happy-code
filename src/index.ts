#!/usr/bin/env node

import { HappyCodeApp } from './core/app';

/**
 * Main entry point for Happy Code CLI
 */
async function main(): Promise<void> {
  try {
    const app = new HappyCodeApp();
    await app.run(process.argv);
  } catch (error) {
    console.error('Fatal error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the application
if (require.main === module) {
  main();
}

export { HappyCodeApp } from './core/app';