#!/usr/bin/env node

/**
 * 测试 ReAct 功能的脚本
 */

const path = require('path');
const { ConfigManager } = require('./dist/core/config');
const { Logger } = require('./dist/core/logger');
const { SessionManager } = require('./dist/core/session');
const { ToolRegistry } = require('./dist/core/tools');
const { ChatInterface } = require('./dist/core/chat');

async function testReAct() {
  console.log('🧪 Testing ReAct implementation...\n');

  // 初始化依赖
  const config = new ConfigManager();
  const logger = new Logger(config);
  const sessionManager = new SessionManager(config, logger);
  const toolRegistry = new ToolRegistry(config, logger);

  // 工具已在构造函数中初始化
  sessionManager.createSession();

  // 创建聊天接口
  const chatInterface = new ChatInterface(config, logger, sessionManager, toolRegistry);

  console.log('📝 Test Cases:');
  console.log('1. "analyze the test-react.md file"');
  console.log('2. "find all TypeScript files in the project"');
  console.log('3. "help me understand the project structure"\n');

  // 测试用例
  const testCases = [
    'analyze the test-react.md file',
    'find all TypeScript files in the project',
    'help me understand the project structure'
  ];

  for (let i = 0; i < testCases.length; i++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 Test Case ${i + 1}: "${testCases[i]}"`);
    console.log('='.repeat(60));

    try {
      await chatInterface.sendMessage(testCases[i]);
    } catch (error) {
      console.error('❌ Test failed:', error.message);
    }

    // 添加延迟以避免 API 限制
    if (i < testCases.length - 1) {
      console.log('\n⏳ Waiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n✅ ReAct testing completed!');
}

// 运行测试
testReAct().catch(console.error);