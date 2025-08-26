import { ILLMService, ModelInfo } from '../interfaces/ILLMService';
import { ErrorInfo, ChatMessage } from '../types';
import { TokenManager } from './TokenManager';

export interface LLMConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
    timeout: number;
}

export class LLMService implements ILLMService {
    private config: LLMConfig;
    private tokenManager: TokenManager;
    private readonly defaultConfig: Partial<LLMConfig> = {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo',
        maxTokens: 4096,
        temperature: 0.7,
        timeout: 30000,
    };

    constructor(config: Partial<LLMConfig>) {
        this.config = { ...this.defaultConfig, ...config } as LLMConfig;

        if (!this.config.apiKey) {
            throw new Error('API key is required for LLM service');
        }

        const contextWindow = this.getContextWindow(this.config.model);
        this.tokenManager = new TokenManager(this.config.maxTokens, contextWindow);
    }

    async *generateResponse(prompt: string, context: string): AsyncGenerator<string> {
        try {
            const response = await this.makeStreamingRequest(prompt, context);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body available');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.trim() === '') continue;
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') return;

                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content;
                                if (content) {
                                    yield content;
                                }
                            } catch (parseError) {
                                console.warn('Failed to parse streaming response:', parseError);
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } catch (error) {
            throw this.createLLMError(error);
        }
    }

    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.config.baseUrl}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(5000),
            });

            return response.ok;
        } catch (error) {
            console.error('Connection validation failed:', error);
            return false;
        }
    }

    async getModelInfo(): Promise<ModelInfo> {
        try {
            const response = await fetch(`${this.config.baseUrl}/models/${this.config.model}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to get model info: ${response.statusText}`);
            }

            const data = await response.json();

            return {
                name: this.config.model,
                maxTokens: this.config.maxTokens,
                contextWindow: this.getContextWindow(this.config.model),
                supportsStreaming: true,
            };
        } catch (error) {
            // Return default info if API call fails
            return {
                name: this.config.model,
                maxTokens: this.config.maxTokens,
                contextWindow: this.getContextWindow(this.config.model),
                supportsStreaming: true,
            };
        }
    }

    estimateTokens(text: string): number {
        return this.tokenManager.estimateTokens(text);
    }

    optimizeForTokenLimits(prompt: string, context: string, history: ChatMessage[] = []): {
        optimizedPrompt: string;
        optimizedContext: string;
        optimizedHistory: ChatMessage[];
        tokenInfo: {
            original: number;
            optimized: number;
            saved: number;
        };
    } {
        // Optimize conversation history first
        const optimizedHistory = this.tokenManager.optimizeConversationHistory(history);

        // Optimize prompt and context
        const optimization = this.tokenManager.optimizePrompt(prompt, context);

        const originalTokens = this.tokenManager.estimateTokens(prompt + context) +
            history.reduce((sum, msg) => sum + this.tokenManager.calculateMessageTokens(msg), 0);

        const optimizedTokens = this.tokenManager.estimateTokens(optimization.optimizedPrompt + context) +
            optimizedHistory.reduce((sum, msg) => sum + this.tokenManager.calculateMessageTokens(msg), 0);

        return {
            optimizedPrompt: optimization.optimizedPrompt,
            optimizedContext: context,
            optimizedHistory,
            tokenInfo: {
                original: originalTokens,
                optimized: optimizedTokens,
                saved: originalTokens - optimizedTokens,
            },
        };
    }

    private async makeStreamingRequest(prompt: string, context: string): Promise<Response> {
        const messages = [
            {
                role: 'system',
                content: context || 'You are a helpful AI assistant integrated into the Kiro IDE.',
            },
            {
                role: 'user',
                content: prompt,
            },
        ];

        const requestBody = {
            model: this.config.model,
            messages,
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
            stream: true,
        };

        return fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(this.config.timeout),
        });
    }

    private getContextWindow(model: string): number {
        const contextWindows: Record<string, number> = {
            'gpt-3.5-turbo': 4096,
            'gpt-3.5-turbo-16k': 16384,
            'gpt-4': 8192,
            'gpt-4-32k': 32768,
            'gpt-4-turbo': 128000,
            'claude-3-sonnet': 200000,
            'claude-3-opus': 200000,
        };

        return contextWindows[model] || 4096;
    }

    private createLLMError(error: unknown): Error {
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                return new Error('Request timeout - the LLM service took too long to respond');
            }
            if (error.message.includes('401')) {
                return new Error('Authentication failed - please check your API key');
            }
            if (error.message.includes('429')) {
                return new Error('Rate limit exceeded - please try again later');
            }
            if (error.message.includes('500')) {
                return new Error('LLM service is temporarily unavailable');
            }
            return error;
        }

        return new Error('Unknown error occurred while communicating with LLM service');
    }
}