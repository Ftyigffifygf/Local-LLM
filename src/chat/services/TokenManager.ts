import { ChatMessage } from '../types';

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface OptimizationResult {
    optimizedPrompt: string;
    removedContent: string[];
    tokensSaved: number;
}

export class TokenManager {
    private readonly CHARS_PER_TOKEN = 4; // Rough approximation
    private readonly MAX_CONTEXT_RATIO = 0.7; // Use 70% of context window for history

    constructor(private maxTokens: number, private contextWindow: number) { }

    estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / this.CHARS_PER_TOKEN);
    }

    calculateMessageTokens(message: ChatMessage): number {
        let tokens = 0;

        // Base tokens for message structure
        tokens += 4; // role, content wrapper tokens

        // Content tokens
        tokens += this.estimateTokens(message.content);

        // Context tokens if present
        if (message.context) {
            if (message.context.activeFile) {
                tokens += this.estimateTokens(message.context.activeFile);
            }
            if (message.context.selectedText) {
                tokens += this.estimateTokens(message.context.selectedText);
            }
            if (message.context.workspaceFiles) {
                tokens += message.context.workspaceFiles.reduce(
                    (sum, file) => sum + this.estimateTokens(file), 0
                );
            }
        }

        return tokens;
    }

    optimizePrompt(prompt: string, context: string, maxTokens?: number): OptimizationResult {
        const targetTokens = maxTokens || this.maxTokens;
        const currentTokens = this.estimateTokens(prompt + context);

        if (currentTokens <= targetTokens) {
            return {
                optimizedPrompt: prompt,
                removedContent: [],
                tokensSaved: 0,
            };
        }

        const removedContent: string[] = [];
        let optimizedContext = context;
        let tokensToSave = currentTokens - targetTokens;

        // Strategy 1: Truncate context from the end
        if (tokensToSave > 0) {
            const contextTokens = this.estimateTokens(optimizedContext);
            if (contextTokens > tokensToSave) {
                const targetContextLength = Math.floor(
                    (contextTokens - tokensToSave) * this.CHARS_PER_TOKEN
                );
                const truncated = optimizedContext.substring(contextTokens - targetContextLength);
                removedContent.push(`Truncated ${optimizedContext.length - truncated.length} characters from context`);
                optimizedContext = truncated;
                tokensToSave -= (contextTokens - this.estimateTokens(optimizedContext));
            }
        }

        // Strategy 2: Remove less important sections
        if (tokensToSave > 0) {
            optimizedContext = this.removeNonEssentialContent(optimizedContext, tokensToSave, removedContent);
        }

        const finalTokens = this.estimateTokens(prompt + optimizedContext);
        const tokensSaved = currentTokens - finalTokens;

        return {
            optimizedPrompt: prompt,
            removedContent,
            tokensSaved,
        };
    }

    optimizeConversationHistory(messages: ChatMessage[], maxHistoryTokens?: number): ChatMessage[] {
        const maxTokens = maxHistoryTokens || Math.floor(this.contextWindow * this.MAX_CONTEXT_RATIO);

        if (messages.length === 0) return messages;

        // Always keep the last message (current user input)
        const lastMessage = messages[messages.length - 1];
        const remainingMessages = messages.slice(0, -1);

        let totalTokens = this.calculateMessageTokens(lastMessage);
        const optimizedMessages: ChatMessage[] = [lastMessage];

        // Add messages from most recent backwards until we hit token limit
        for (let i = remainingMessages.length - 1; i >= 0; i--) {
            const message = remainingMessages[i];
            const messageTokens = this.calculateMessageTokens(message);

            if (totalTokens + messageTokens <= maxTokens) {
                totalTokens += messageTokens;
                optimizedMessages.unshift(message);
            } else {
                // Try to include a truncated version of this message
                const availableTokens = maxTokens - totalTokens;
                if (availableTokens > 50) { // Only if we have reasonable space
                    const truncatedMessage = this.truncateMessage(message, availableTokens);
                    if (truncatedMessage) {
                        optimizedMessages.unshift(truncatedMessage);
                    }
                }
                break;
            }
        }

        return optimizedMessages;
    }

    validateTokenLimits(prompt: string, context: string, history: ChatMessage[]): {
        isValid: boolean;
        issues: string[];
        suggestions: string[];
    } {
        const issues: string[] = [];
        const suggestions: string[] = [];

        const promptTokens = this.estimateTokens(prompt);
        const contextTokens = this.estimateTokens(context);
        const historyTokens = history.reduce((sum, msg) => sum + this.calculateMessageTokens(msg), 0);
        const totalTokens = promptTokens + contextTokens + historyTokens;

        // Check against context window
        if (totalTokens > this.contextWindow) {
            issues.push(`Total tokens (${totalTokens}) exceed context window (${this.contextWindow})`);
            suggestions.push('Consider reducing conversation history or context length');
        }

        // Check against max tokens for completion
        const availableForCompletion = this.contextWindow - totalTokens;
        if (availableForCompletion < this.maxTokens * 0.1) {
            issues.push('Very little space left for LLM response');
            suggestions.push('Reduce input length to allow for meaningful response');
        }

        // Check individual components
        if (promptTokens > this.maxTokens * 0.5) {
            issues.push('Prompt is very long');
            suggestions.push('Consider breaking down the request into smaller parts');
        }

        if (contextTokens > this.contextWindow * 0.3) {
            issues.push('Context is very large');
            suggestions.push('Consider reducing workspace context or selected text');
        }

        return {
            isValid: issues.length === 0,
            issues,
            suggestions,
        };
    }

    private removeNonEssentialContent(context: string, tokensToSave: number, removedContent: string[]): string {
        let optimized = context;
        let tokensSaved = 0;

        // Remove comments (lines starting with # or //)
        const commentPattern = /^[ \t]*(?:#|\/\/).*$/gm;
        const comments = optimized.match(commentPattern);
        if (comments && tokensSaved < tokensToSave) {
            optimized = optimized.replace(commentPattern, '');
            const commentTokens = comments.reduce((sum, comment) => sum + this.estimateTokens(comment), 0);
            tokensSaved += commentTokens;
            removedContent.push(`Removed ${comments.length} comment lines`);
        }

        // Remove excessive whitespace
        if (tokensSaved < tokensToSave) {
            const beforeWhitespace = optimized.length;
            optimized = optimized.replace(/\n\s*\n\s*\n/g, '\n\n'); // Multiple empty lines to double
            optimized = optimized.replace(/[ \t]+/g, ' '); // Multiple spaces to single
            const afterWhitespace = optimized.length;
            const whitespaceTokens = this.estimateTokens(' '.repeat(beforeWhitespace - afterWhitespace));
            tokensSaved += whitespaceTokens;
            if (beforeWhitespace !== afterWhitespace) {
                removedContent.push('Compressed whitespace');
            }
        }

        // Remove import statements if still need to save tokens
        if (tokensSaved < tokensToSave) {
            const importPattern = /^import.*?;$/gm;
            const imports = optimized.match(importPattern);
            if (imports) {
                optimized = optimized.replace(importPattern, '');
                const importTokens = imports.reduce((sum, imp) => sum + this.estimateTokens(imp), 0);
                tokensSaved += importTokens;
                removedContent.push(`Removed ${imports.length} import statements`);
            }
        }

        return optimized;
    }

    private truncateMessage(message: ChatMessage, maxTokens: number): ChatMessage | null {
        const baseTokens = 10; // Estimated tokens for message structure
        const availableContentTokens = maxTokens - baseTokens;

        if (availableContentTokens < 20) return null; // Not worth truncating

        const maxContentLength = availableContentTokens * this.CHARS_PER_TOKEN;
        if (message.content.length <= maxContentLength) return message;

        const truncatedContent = message.content.substring(0, maxContentLength - 20) + '... [truncated]';

        return {
            ...message,
            content: truncatedContent,
            metadata: {
                ...message.metadata,
                truncated: true,
            },
        };
    }
}