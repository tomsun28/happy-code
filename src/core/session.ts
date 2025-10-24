import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { Session, ChatMessage, TodoItem } from '../types';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private currentSessionId: string | null = null;

  public createSession(): string {
    const sessionId = uuidv4();
    const session: Session = {
      id: sessionId,
      startTime: new Date(),
      messages: [],
      todos: [],
      context: {}
    };

    this.sessions.set(sessionId, session);
    this.currentSessionId = sessionId;
    return sessionId;
  }

  public getCurrentSession(): Session | null {
    if (!this.currentSessionId) {
      return null;
    }
    return this.sessions.get(this.currentSessionId) || null;
  }

  public getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) || null;
  }

  public addMessage(message: Omit<ChatMessage, 'timestamp'>): void {
    const session = this.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const chatMessage: ChatMessage = {
      ...message
    };

    session.messages.push(chatMessage);
  }

  public addTodo(todo: Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>): string {
    const session = this.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const todoItem: TodoItem = {
      ...todo,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    session.todos.push(todoItem);
    return todoItem.id;
  }

  public updateTodo(todoId: string, updates: Partial<TodoItem>): void {
    const session = this.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const todoIndex = session.todos.findIndex(todo => todo.id === todoId);
    if (todoIndex === -1) {
      throw new Error(`Todo with id ${todoId} not found`);
    }

    session.todos[todoIndex] = {
      ...session.todos[todoIndex],
      ...updates,
      updatedAt: new Date()
    };
  }

  public deleteTodo(todoId: string): void {
    const session = this.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    const todoIndex = session.todos.findIndex(todo => todo.id === todoId);
    if (todoIndex === -1) {
      throw new Error(`Todo with id ${todoId} not found`);
    }

    session.todos.splice(todoIndex, 1);
  }

  public getTodos(): TodoItem[] {
    const session = this.getCurrentSession();
    return session ? session.todos : [];
  }

  public setContext(key: string, value: any): void {
    const session = this.getCurrentSession();
    if (!session) {
      throw new Error('No active session');
    }

    session.context[key] = value;
  }

  public getContext(key?: string): any {
    const session = this.getCurrentSession();
    if (!session) {
      return null;
    }

    if (key) {
      return session.context[key];
    }

    return session.context;
  }

  public clearSession(): void {
    const session = this.getCurrentSession();
    if (session) {
      session.messages = [];
      session.todos = [];
      session.context = {};
    }
  }

  public endSession(): void {
    if (this.currentSessionId) {
      this.sessions.delete(this.currentSessionId);
      this.currentSessionId = null;
    }
  }

  public listSessions(): Array<{ id: string; startTime: Date; messageCount: number; todoCount: number }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      startTime: session.startTime,
      messageCount: session.messages.length,
      todoCount: session.todos.length
    }));
  }
}