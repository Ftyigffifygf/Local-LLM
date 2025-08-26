import { ChatMessage } from '../types';

export function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function createUserMessage(content: string): ChatMessage {
    return {
        id: generateMessageId(),
        role: 'user',
        content,
        timestamp: new Date(),
    };
}

export function createAssistantMessage(content: string): ChatMessage {
    return {
        id: generateMessageId(),
        role: 'assistant',
        content,
        timestamp: new Date(),
    };
}

export function formatTimestamp(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}