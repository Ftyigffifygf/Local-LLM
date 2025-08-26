import { ChatMessage, SerializedChatMessage, ChatContext } from '../types';

export class SerializationUtils {
    /**
     * Serializes a ChatMessage for storage or transmission
     */
    static serializeMessage(message: ChatMessage): SerializedChatMessage {
        return {
            id: message.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp.toISOString(),
            context: message.context,
            metadata: message.metadata,
        };
    }

    /**
     * Deserializes a ChatMessage from storage or transmission
     */
    static deserializeMessage(serialized: SerializedChatMessage): ChatMessage {
        return {
            id: serialized.id,
            role: serialized.role,
            content: serialized.content,
            timestamp: new Date(serialized.timestamp),
            context: serialized.context,
            metadata: serialized.metadata,
        };
    }

    /**
     * Serializes an array of ChatMessages
     */
    static serializeMessages(messages: ChatMessage[]): SerializedChatMessage[] {
        return messages.map(msg => this.serializeMessage(msg));
    }

    /**
     * Deserializes an array of ChatMessages
     */
    static deserializeMessages(serialized: SerializedChatMessage[]): ChatMessage[] {
        return serialized.map(msg => this.deserializeMessage(msg));
    }

    /**
     * Creates a deep copy of a ChatContext object
     */
    static cloneContext(context: ChatContext): ChatContext {
        return {
            activeFile: context.activeFile,
            selectedText: context.selectedText,
            workspaceFiles: context.workspaceFiles ? [...context.workspaceFiles] : undefined,
            gitStatus: context.gitStatus ? {
                branch: context.gitStatus.branch,
                hasChanges: context.gitStatus.hasChanges,
                recentCommits: context.gitStatus.recentCommits ? [...context.gitStatus.recentCommits] : undefined,
            } : undefined,
            specContext: context.specContext ? {
                currentSpec: context.specContext.currentSpec,
                phase: context.specContext.phase,
                context: context.specContext.context,
            } : undefined,
        };
    }

    /**
     * Safely converts any value to JSON string with error handling
     */
    static safeStringify(value: any): string {
        try {
            return JSON.stringify(value, null, 2);
        } catch (error) {
            return `[Serialization Error: ${error instanceof Error ? error.message : 'Unknown error'}]`;
        }
    }

    /**
     * Safely parses JSON string with error handling
     */
    static safeParse<T>(jsonString: string): T | null {
        try {
            return JSON.parse(jsonString) as T;
        } catch (error) {
            console.error('JSON parsing error:', error);
            return null;
        }
    }
}