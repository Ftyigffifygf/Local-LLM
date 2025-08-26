import { LLMService } from '../services/LLMService';

// Mock fetch globally
global.fetch = jest.fn();

describe('LLMService', () => {
    let llmService: LLMService;
    const mockConfig = {
        apiKey: 'test-api-key',
        model: 'gpt-3.5-turbo',
    };

    beforeEach(() => {
        llmService = new LLMService(mockConfig);
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should throw error if no API key provided', () => {
            expect(() => new LLMService({})).toThrow('API key is required for LLM service');
        });

        it('should use default config values', () => {
            const service = new LLMService({ apiKey: 'test' });
            expect(service).toBeDefined();
        });
    });

    describe('validateConnection', () => {
        it('should return true for successful connection', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
            });

            const result = await llmService.validateConnection();
            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/models'),
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-api-key',
                    }),
                })
            );
        });

        it('should return false for failed connection', async () => {
            (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            const result = await llmService.validateConnection();
            expect(result).toBe(false);
        });
    });

    describe('getModelInfo', () => {
        it('should return model information', async () => {
            const mockModelData = {
                id: 'gpt-3.5-turbo',
                object: 'model',
            };

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockModelData),
            });

            const result = await llmService.getModelInfo();

            expect(result).toEqual({
                name: 'gpt-3.5-turbo',
                maxTokens: 4096,
                contextWindow: 4096,
                supportsStreaming: true,
            });
        });

        it('should return default info if API call fails', async () => {
            (fetch as jest.Mock).mockRejectedValueOnce(new Error('API error'));

            const result = await llmService.getModelInfo();

            expect(result).toEqual({
                name: 'gpt-3.5-turbo',
                maxTokens: 4096,
                contextWindow: 4096,
                supportsStreaming: true,
            });
        });
    });

    describe('estimateTokens', () => {
        it('should estimate tokens correctly', () => {
            const text = 'Hello world'; // 11 characters
            const result = llmService.estimateTokens(text);
            expect(result).toBe(3); // Math.ceil(11/4) = 3
        });

        it('should handle empty string', () => {
            const result = llmService.estimateTokens('');
            expect(result).toBe(0);
        });
    });

    describe('generateResponse', () => {
        it('should handle streaming response', async () => {
            const mockStreamData = [
                'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
                'data: {"choices":[{"delta":{"content":" world"}}]}\n',
                'data: [DONE]\n',
            ];

            const mockReader = {
                read: jest.fn()
                    .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(mockStreamData[0]) })
                    .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(mockStreamData[1]) })
                    .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(mockStreamData[2]) })
                    .mockResolvedValueOnce({ done: true, value: undefined }),
                releaseLock: jest.fn(),
            };

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => mockReader,
                },
            });

            const generator = llmService.generateResponse('Test prompt', 'Test context');
            const results = [];

            for await (const chunk of generator) {
                results.push(chunk);
            }

            expect(results).toEqual(['Hello', ' world']);
            expect(mockReader.releaseLock).toHaveBeenCalled();
        });

        it('should handle API errors', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
            });

            const generator = llmService.generateResponse('Test prompt', 'Test context');

            await expect(async () => {
                for await (const chunk of generator) {
                    // Should throw before yielding any chunks
                }
            }).rejects.toThrow('HTTP 401: Unauthorized');
        });

        it('should handle network errors', async () => {
            (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            const generator = llmService.generateResponse('Test prompt', 'Test context');

            await expect(async () => {
                for await (const chunk of generator) {
                    // Should throw before yielding any chunks
                }
            }).rejects.toThrow();
        });
    });
});