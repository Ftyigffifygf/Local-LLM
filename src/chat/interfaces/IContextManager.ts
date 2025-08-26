import { ContextType, ChatContext } from '../types';

export interface IContextManager {
    gatherContext(type: ContextType): Promise<ContextData>;
    formatForLLM(context: ContextData): string;
    getCurrentContext(): Promise<ChatContext>;
    watchForChanges(callback: (context: ChatContext) => void): void;
}

export interface ContextData {
    type: ContextType;
    content: string;
    metadata: Record<string, any>;
    timestamp: Date;
}