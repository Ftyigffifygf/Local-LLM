export interface ILLMService {
    generateResponse(prompt: string, context: string): AsyncGenerator<string>;
    validateConnection(): Promise<boolean>;
    getModelInfo(): Promise<ModelInfo>;
    estimateTokens(text: string): number;
}

export interface ModelInfo {
    name: string;
    maxTokens: number;
    contextWindow: number;
    supportsStreaming: boolean;
}