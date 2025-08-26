import { ChatMessage, SerializedChatMessage, ChatConfig } from '../types';
import { SerializationUtils } from '../utils/serializationUtils';

export interface ConversationState {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: Date;
    lastModified: Date;
    metadata: {
        messageCount: number;
        totalTokens: number;
        activeContext?: string;
    };
}

export interface SerializedConversationState {
    id: string;
    title: string;
    messages: SerializedChatMessage[];
    createdAt: string;
    lastModified: string;
    metadata: {
        messageCount: number;
        totalTokens: number;
        activeContext?: string;
    };
}

export interface StorageAdapter {
    save(key: string, data: string): Promise<void>;
    load(key: string): Promise<string | null>;
    delete(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
}

export class ConversationStateManager {
    private currentConversation: ConversationState | null = null;
    private readonly STORAGE_PREFIX = 'kiro_chat_conversation_';
    private readonly CONFIG_KEY = 'kiro_chat_config';

    constructor(
        private storage: StorageAdapter,
        private config: ChatConfig
    ) { }

    async createNewConversation(title?: string): Promise<ConversationState> {
        const conversation: ConversationState = {
            id: this.generateConversationId(),
            title: title || this.generateConversationTitle(),
            messages: [],
            createdAt: new Date(),
            lastModified: new Date(),
            metadata: {
                messageCount: 0,
                totalTokens: 0,
            },
        };

        this.currentConversation = conversation;
        await this.saveConversation(conversation);
        return conversation;
    }

    async loadConversation(conversationId: string): Promise<ConversationState | null> {
        try {
            const key = this.STORAGE_PREFIX + conversationId;
            const data = await this.storage.load(key);

            if (!data) {
                return null;
            }

            const serialized = SerializationUtils.safeParse<SerializedConversationState>(data);
            if (!serialized) {
                console.error(`Failed to parse conversation ${conversationId}`);
                return null;
            }

            const conversation = this.deserializeConversation(serialized);
            this.currentConversation = conversation;
            return conversation;
        } catch (error) {
            console.error(`Error loading conversation ${conversationId}:`, error);
            return null;
        }
    }

    async saveConversation(conversation?: ConversationState): Promise<void> {
        const conv = conversation || this.currentConversation;
        if (!conv) {
            throw new Error('No conversation to save');
        }

        try {
            const serialized = this.serializeConversation(conv);
            const key = this.STORAGE_PREFIX + conv.id;
            const data = SerializationUtils.safeStringify(serialized);

            await this.storage.save(key, data);

            // Auto-save config if enabled
            if (this.config.autoSaveHistory) {
                await this.saveConfig();
            }
        } catch (error) {
            console.error('Error saving conversation:', error);
            throw new Error('Failed to save conversation');
        }
    }

    async deleteConversation(conversationId: string): Promise<void> {
        try {
            const key = this.STORAGE_PREFIX + conversationId;
            await this.storage.delete(key);

            if (this.currentConversation?.id === conversationId) {
                this.currentConversation = null;
            }
        } catch (error) {
            console.error(`Error deleting conversation ${conversationId}:`, error);
            throw new Error('Failed to delete conversation');
        }
    }

    async listConversations(): Promise<ConversationState[]> {
        try {
            const keys = await this.storage.list(this.STORAGE_PREFIX);
            const conversations: ConversationState[] = [];

            for (const key of keys) {
                const data = await this.storage.load(key);
                if (data) {
                    const serialized = SerializationUtils.safeParse<SerializedConversationState>(data);
                    if (serialized) {
                        conversations.push(this.deserializeConversation(serialized));
                    }
                }
            }

            // Sort by last modified date, most recent first
            return conversations.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
        } catch (error) {
            console.error('Error listing conversations:', error);
            return [];
        }
    }

    getCurrentConversation(): ConversationState | null {
        return this.currentConversation;
    }

    addMessage(message: ChatMessage): void {
        if (!this.currentConversation) {
            throw new Error('No active conversation');
        }

        this.currentConversation.messages.push(message);
        this.currentConversation.lastModified = new Date();
        this.currentConversation.metadata.messageCount = this.currentConversation.messages.length;

        // Update token count if available
        if (message.metadata?.tokenCount) {
            this.currentConversation.metadata.totalTokens += message.metadata.tokenCount;
        }

        // Auto-save if enabled
        if (this.config.autoSaveHistory) {
            this.saveConversation().catch(error => {
                console.error('Auto-save failed:', error);
            });
        }
    }

    getMessages(): ChatMessage[] {
        return this.currentConversation?.messages || [];
    }

    clearCurrentConversation(): void {
        if (this.currentConversation) {
            this.currentConversation.messages = [];
            this.currentConversation.lastModified = new Date();
            this.currentConversation.metadata.messageCount = 0;
            this.currentConversation.metadata.totalTokens = 0;
        }
    }

    async trimConversationHistory(maxMessages?: number): Promise<void> {
        if (!this.currentConversation) return;

        const limit = maxMessages || this.config.maxHistoryLength;
        if (this.currentConversation.messages.length <= limit) return;

        // Keep the most recent messages
        const trimmedMessages = this.currentConversation.messages.slice(-limit);
        const removedCount = this.currentConversation.messages.length - trimmedMessages.length;

        this.currentConversation.messages = trimmedMessages;
        this.currentConversation.lastModified = new Date();
        this.currentConversation.metadata.messageCount = trimmedMessages.length;

        console.log(`Trimmed ${removedCount} messages from conversation history`);

        // Save the trimmed conversation
        await this.saveConversation();
    }

    async exportConversation(conversationId?: string): Promise<string> {
        const conv = conversationId
            ? await this.loadConversation(conversationId)
            : this.currentConversation;

        if (!conv) {
            throw new Error('Conversation not found');
        }

        const exportData = {
            title: conv.title,
            createdAt: conv.createdAt.toISOString(),
            lastModified: conv.lastModified.toISOString(),
            messageCount: conv.metadata.messageCount,
            messages: conv.messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp.toISOString(),
            })),
        };

        return SerializationUtils.safeStringify(exportData);
    }

    async importConversation(data: string, title?: string): Promise<ConversationState> {
        const importData = SerializationUtils.safeParse<any>(data);
        if (!importData || !importData.messages) {
            throw new Error('Invalid conversation data');
        }

        const conversation: ConversationState = {
            id: this.generateConversationId(),
            title: title || importData.title || 'Imported Conversation',
            messages: importData.messages.map((msg: any) => ({
                id: this.generateMessageId(),
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.timestamp),
            })),
            createdAt: new Date(),
            lastModified: new Date(),
            metadata: {
                messageCount: importData.messages.length,
                totalTokens: 0, // Will be recalculated if needed
            },
        };

        await this.saveConversation(conversation);
        return conversation;
    }

    private async saveConfig(): Promise<void> {
        try {
            const configData = SerializationUtils.safeStringify(this.config);
            await this.storage.save(this.CONFIG_KEY, configData);
        } catch (error) {
            console.error('Error saving config:', error);
        }
    }

    private serializeConversation(conversation: ConversationState): SerializedConversationState {
        return {
            id: conversation.id,
            title: conversation.title,
            messages: SerializationUtils.serializeMessages(conversation.messages),
            createdAt: conversation.createdAt.toISOString(),
            lastModified: conversation.lastModified.toISOString(),
            metadata: conversation.metadata,
        };
    }

    private deserializeConversation(serialized: SerializedConversationState): ConversationState {
        return {
            id: serialized.id,
            title: serialized.title,
            messages: SerializationUtils.deserializeMessages(serialized.messages),
            createdAt: new Date(serialized.createdAt),
            lastModified: new Date(serialized.lastModified),
            metadata: serialized.metadata,
        };
    }

    private generateConversationId(): string {
        return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateConversationTitle(): string {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = now.toLocaleDateString();
        return `Chat ${dateStr} ${timeStr}`;
    }
}