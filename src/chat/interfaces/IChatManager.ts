import { ChatMessage, ChatResponse, ChatContext } from '../types';

export interface IChatManager {
    sendMessage(message: string, context?: ChatContext): Promise<ChatResponse>;
    getHistory(): ChatMessage[];
    clearHistory(): void;
    addMessage(message: ChatMessage): void;
    getLastMessages(count: number): ChatMessage[];
}