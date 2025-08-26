import { IChatManager } from '../interfaces/IChatManager';
import { ILLMService } from '../interfaces/ILLMService';
import { IContextManager } from '../interfaces/IContextManager';
import { ISafetyFilter } from '../interfaces/ISafetyFilter';
import { ChatMessage, ChatResponse, ChatContext, ErrorInfo } from '../types';
import { createUserMessage, createAssistantMessage } from '../utils/messageUtils';
import { SpecContextProvider } from './SpecContextProvider';
import { ConversationStateManager, StorageAdapter } from './ConversationStateManager';

export interface ChatManagerConfig {
    maxHistoryLength: number;
    enableContextGathering: boolean;
    enableSafetyFilter: boolean;
    retryAttempts: number;
    retryDelay: number;
}

export class ChatManager implements IChatManager {
    private isProcessing = false;
    private readonly config: ChatManagerConfig;
    private stateManager: ConversationStateManager;

    constructor(
        private llmService: ILLMService,
        private contextManager: IContextManager,
        private safetyFilter: ISafetyFilter,
        private specContextProvider: SpecContextProvider,
        private storageAdapter: StorageAdapter,
        config: Partial<ChatManagerConfig> = {}
    ) {
        this.config = {
            maxHistoryLength: 50,
            enableContextGathering: true,
            enableSafetyFilter: true,
            retryAttempts: 3,
            retryDelay: 1000,
            ...config,
        };

        // Initialize state manager with chat config
        const chatConfig = {
            maxHistoryLength: this.config.maxHistoryLength,
            maxTokensPerMessage: 4000,
            enableStreaming: true,
            safetyLevel: 'moderate' as const,
            autoSaveHistory: true,
        };

        this.stateManager = new ConversationStateManager(storageAdapter, chatConfig);

        // Create initial conversation if none exists
        this.initializeConversation();
    }

    private async initializeConversation(): Promise<void> {
        try {
            const current = this.stateManager.getCurrentConversation();
            if (!current) {
                await this.stateManager.createNewConversation();
            }
        } catch (error) {
            console.error('Failed to initialize conversation:', error);
        }
    }

    async sendMessage(message: string, context?: ChatContext): Promise<ChatResponse> {
        if (this.isProcessing) {
            return this.createErrorResponse('Another message is currently being processed');
        }

        this.isProcessing = true;

        try {
            // Validate the request
            if (this.config.enableSafetyFilter) {
                const validation = this.safetyFilter.validateRequest(message);
                if (!validation.isValid) {
                    return this.createErrorResponse(
                        `Message blocked: ${validation.errors.join(', ')}`,
                        'validation'
                    );
                }
            }

            // Create user message
            const userMessage = createUserMessage(message);
            if (context) {
                userMessage.context = context;
            }

            // Gather additional context if enabled
            if (this.config.enableContextGathering) {
                try {
                    const currentContext = await this.contextManager.getCurrentContext();
                    userMessage.context = { ...currentContext, ...userMessage.context };
                } catch (error) {
                    console.warn('Failed to gather context:', error);
                }
            }

            // Add user message to conversation
            this.stateManager.addMessage(userMessage);

            // Generate response with retry logic
            const assistantMessage = await this.generateResponseWithRetry(userMessage);

            // Add assistant message to conversation
            this.stateManager.addMessage(assistantMessage);

            // Trim history if needed
            await this.stateManager.trimConversationHistory();

            return {
                message: assistantMessage,
                suggestions: this.generateSuggestions(assistantMessage),
                actions: this.extractActions(assistantMessage),
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return this.createErrorResponse(errorMessage, 'system');
        } finally {
            this.isProcessing = false;
        }
    }

    getHistory(): ChatMessage[] {
        return this.stateManager.getMessages();
    }

    clearHistory(): void {
        this.stateManager.clearCurrentConversation();
    }

    addMessage(message: ChatMessage): void {
        this.stateManager.addMessage(message);
    }

    getLastMessages(count: number): ChatMessage[] {
        const messages = this.stateManager.getMessages();
        return messages.slice(-count);
    }

    // Additional conversation management methods
    async createNewConversation(title?: string) {
        return await this.stateManager.createNewConversation(title);
    }

    async loadConversation(conversationId: string) {
        return await this.stateManager.loadConversation(conversationId);
    }

    async saveCurrentConversation() {
        return await this.stateManager.saveConversation();
    }

    async listConversations() {
        return await this.stateManager.listConversations();
    }

    async exportConversation(conversationId?: string) {
        return await this.stateManager.exportConversation(conversationId);
    }

    private async generateResponseWithRetry(userMessage: ChatMessage): Promise<ChatMessage> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                return await this.generateResponse(userMessage);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');

                if (attempt < this.config.retryAttempts) {
                    console.warn(`Attempt ${attempt} failed, retrying in ${this.config.retryDelay}ms:`, error);
                    await this.delay(this.config.retryDelay * attempt); // Exponential backoff
                }
            }
        }

        throw lastError || new Error('All retry attempts failed');
    }

    private async generateResponse(userMessage: ChatMessage): Promise<ChatMessage> {
        // Build context for LLM
        const contextString = await this.buildContextString(userMessage);

        // Optimize for token limits
        const optimization = this.llmService.optimizeForTokenLimits(
            userMessage.content,
            contextString,
            this.getRecentHistory()
        );

        // Generate streaming response
        const responseChunks: string[] = [];
        const startTime = Date.now();

        try {
            for await (const chunk of this.llmService.generateResponse(
                optimization.optimizedPrompt,
                optimization.optimizedContext
            )) {
                responseChunks.push(chunk);
            }
        } catch (error) {
            throw new Error(`LLM generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const responseContent = responseChunks.join('');
        const processingTime = Date.now() - startTime;

        // Apply safety filter to response
        const sanitizedContent = this.config.enableSafetyFilter
            ? this.safetyFilter.sanitizeResponse(responseContent)
            : responseContent;

        // Create assistant message
        const assistantMessage = createAssistantMessage(sanitizedContent);
        assistantMessage.metadata = {
            processingTime,
            tokenCount: this.llmService.estimateTokens(sanitizedContent),
            model: 'llm-service', // Would be actual model name
        };

        return assistantMessage;
    }

    private async buildContextString(userMessage: ChatMessage): Promise<string> {
        const contextSections: string[] = [];

        // Add system context
        contextSections.push('You are Kiro, an AI assistant integrated into the Kiro IDE.');
        contextSections.push('You help developers with code generation, debugging, explanations, and project planning.');
        contextSections.push('');

        // Add workspace context if available
        if (userMessage.context) {
            if (userMessage.context.activeFile) {
                contextSections.push(`**Active File:** ${userMessage.context.activeFile}`);
            }

            if (userMessage.context.selectedText) {
                contextSections.push('**Selected Text:**');
                contextSections.push('```');
                contextSections.push(userMessage.context.selectedText);
                contextSections.push('```');
                contextSections.push('');
            }

            if (userMessage.context.gitStatus) {
                contextSections.push(`**Git Status:** Branch: ${userMessage.context.gitStatus.branch}, Changes: ${userMessage.context.gitStatus.hasChanges ? 'Yes' : 'No'}`);
            }
        }

        // Add spec context if relevant
        try {
            const relevantContext = await this.specContextProvider.getRelevantContext(userMessage.content);
            if (relevantContext && relevantContext.trim().length > 0) {
                contextSections.push('**Project Context:**');
                contextSections.push(relevantContext);
                contextSections.push('');
            }
        } catch (error) {
            console.debug('Could not gather spec context:', error);
        }

        // Add conversation history context
        const recentHistory = this.getRecentHistory(5); // Last 5 messages for context
        if (recentHistory.length > 0) {
            contextSections.push('**Recent Conversation:**');
            for (const msg of recentHistory) {
                contextSections.push(`${msg.role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
            }
            contextSections.push('');
        }

        return contextSections.join('\n');
    }

    private getRecentHistory(count: number = 10): ChatMessage[] {
        // Don't include the current message in history context
        const messages = this.stateManager.getMessages();
        return messages.slice(0, -1).slice(-count);
    }

    private generateSuggestions(assistantMessage: ChatMessage): string[] {
        const suggestions: string[] = [];
        const content = assistantMessage.content.toLowerCase();

        // Generate contextual suggestions based on response content
        if (content.includes('code') || content.includes('function')) {
            suggestions.push('Explain this code');
            suggestions.push('Add error handling');
            suggestions.push('Write tests for this');
        }

        if (content.includes('error') || content.includes('bug')) {
            suggestions.push('How can I debug this?');
            suggestions.push('Show me the stack trace');
            suggestions.push('What are common causes?');
        }

        if (content.includes('spec') || content.includes('requirements')) {
            suggestions.push('Create a new spec');
            suggestions.push('Update the design');
            suggestions.push('Generate tasks');
        }

        // Add generic helpful suggestions
        if (suggestions.length < 3) {
            suggestions.push('Can you elaborate?');
            suggestions.push('Show me an example');
            suggestions.push('What are the alternatives?');
        }

        return suggestions.slice(0, 3); // Limit to 3 suggestions
    }

    private extractActions(assistantMessage: ChatMessage): any[] {
        const actions: any[] = [];
        const content = assistantMessage.content;

        // Look for code blocks that might be files to create
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;

        while ((match = codeBlockRegex.exec(content)) !== null) {
            const language = match[1];
            const code = match[2];

            if (code.length > 50 && language) { // Only suggest for substantial code blocks
                actions.push({
                    type: 'create_file',
                    payload: { content: code, language },
                    description: `Create ${language} file with this code`,
                });
            }
        }

        // Look for spec creation mentions
        if (content.toLowerCase().includes('create') && content.toLowerCase().includes('spec')) {
            actions.push({
                type: 'create_spec',
                payload: {},
                description: 'Create a new feature spec',
            });
        }

        return actions;
    }



    private createErrorResponse(message: string, type: ErrorInfo['type'] = 'system'): ChatResponse {
        const errorMessage = createAssistantMessage(`I apologize, but I encountered an error: ${message}`);

        return {
            message: errorMessage,
            error: {
                type,
                message,
                retryable: type === 'network' || type === 'system',
            },
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}