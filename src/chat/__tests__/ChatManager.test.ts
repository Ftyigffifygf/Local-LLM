import { ChatManager } from '../services/ChatManager';
import { ILLMService } from '../interfaces/ILLMService';
import { IContextManager } from '../interfaces/IContextManager';
import { ISafetyFilter } from '../interfaces/ISafetyFilter';
import { SpecContextProvider } from '../services/SpecContextProvider';
import { createUserMessage } from '../utils/messageUtils';

describe('ChatManager', () => {
    let chatManager: ChatManager;
    let mockLLMService: jest.Mocked<ILLMService>;
    let mockContextManager: jest.Mocked<IContextManager>;
    let mockSafetyFilter: jest.Mocked<ISafetyFilter>;
    let mockSpecProvider: jest.Mocked<SpecContextProvider>;

    beforeEach(() => {
        mockLLMService = {
            generateResponse: jest.fn(),
            validateConnection: jest.fn(),
            getModelInfo: jest.fn(),
            estimateTokens: jest.fn(),
            optimizeForTokenLimits: jest.fn(),
        };

        mockContextManager = {
            gatherContext: jest.fn(),
            formatForLLM: jest.fn(),
            getCurrentContext: jest.fn(),
            watchForChanges: jest.fn(),
        };

        mockSafetyFilter = {
            validateRequest: jest.fn(),
            sanitizeResponse: jest.fn(),
            checkForMaliciousCode: jest.fn(),
            filterSensitiveInfo: jest.fn(),
        };

        mockSpecProvider = {
            findActiveSpec: jest.fn(),
            getSpecFiles: jest.fn(),
            getDocumentationFiles: jest.fn(),
            buildSpecContext: jest.fn(),
            buildDocumentationContext: jest.fn(),
            getRelevantContext: jest.fn(),
        } as any;

        chatManager = new ChatManager(
            mockLLMService,
            mockContextManager,
            mockSafetyFilter,
            mockSpecProvider
        );
    });

    describe('sendMessage', () => {
        beforeEach(() => {
            // Setup default mocks
            mockSafetyFilter.validateRequest.mockReturnValue({
                isValid: true,
                errors: [],
                warnings: [],
            });

            mockContextManager.getCurrentContext.mockResolvedValue({
                activeFile: 'src/main.ts',
            });

            mockSpecProvider.getRelevantContext.mockResolvedValue('Project context...');

            mockLLMService.optimizeForTokenLimits.mockReturnValue({
                optimizedPrompt: 'test prompt',
                optimizedContext: 'test context',
                optimizedHistory: [],
                tokenInfo: { original: 100, optimized: 90, saved: 10 },
            });

            mockLLMService.estimateTokens.mockReturnValue(50);
            mockSafetyFilter.sanitizeResponse.mockImplementation(text => text);
        });

        it('should process a valid message successfully', async () => {
            // Mock streaming response
            async function* mockGenerator() {
                yield 'Hello ';
                yield 'world!';
            }
            mockLLMService.generateResponse.mockReturnValue(mockGenerator());

            const response = await chatManager.sendMessage('Hello, how are you?');

            expect(response.message.role).toBe('assistant');
            expect(response.message.content).toBe('Hello world!');
            expect(response.error).toBeUndefined();
            expect(chatManager.getHistory()).toHaveLength(2); // User + Assistant
        });

        it('should block unsafe messages', async () => {
            mockSafetyFilter.validateRequest.mockReturnValue({
                isValid: false,
                errors: ['Dangerous content detected'],
                warnings: [],
            });

            const response = await chatManager.sendMessage('rm -rf /');

            expect(response.error).toBeDefined();
            expect(response.error?.type).toBe('validation');
            expect(response.message.content).toContain('Message blocked');
        });

        it('should handle LLM service errors with retry', async () => {
            mockLLMService.generateResponse
                .mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockImplementationOnce(async function* () {
                    yield 'Success after retry';
                });

            const response = await chatManager.sendMessage('Test message');

            expect(response.message.content).toBe('Success after retry');
            expect(response.error).toBeUndefined();
        });

        it('should fail after max retry attempts', async () => {
            mockLLMService.generateResponse.mockRejectedValue(new Error('Persistent error'));

            const response = await chatManager.sendMessage('Test message');

            expect(response.error).toBeDefined();
            expect(response.error?.type).toBe('system');
            expect(response.message.content).toContain('encountered an error');
        });

        it('should prevent concurrent message processing', async () => {
            async function* slowGenerator() {
                await new Promise(resolve => setTimeout(resolve, 100));
                yield 'Slow response';
            }
            mockLLMService.generateResponse.mockReturnValue(slowGenerator());

            // Start first message
            const promise1 = chatManager.sendMessage('First message');

            // Try to send second message immediately
            const response2 = await chatManager.sendMessage('Second message');

            expect(response2.error).toBeDefined();
            expect(response2.message.content).toContain('Another message is currently being processed');

            // Wait for first message to complete
            const response1 = await promise1;
            expect(response1.error).toBeUndefined();
        });

        it('should include context in LLM request', async () => {
            async function* mockGenerator() {
                yield 'Response with context';
            }
            mockLLMService.generateResponse.mockReturnValue(mockGenerator());

            await chatManager.sendMessage('Test message', {
                activeFile: 'test.ts',
                selectedText: 'console.log("test");',
            });

            expect(mockLLMService.optimizeForTokenLimits).toHaveBeenCalledWith(
                'Test message',
                expect.stringContaining('Active File'),
                expect.any(Array)
            );
        });

        it('should generate relevant suggestions', async () => {
            async function* mockGenerator() {
                yield 'Here is some code: function test() { return true; }';
            }
            mockLLMService.generateResponse.mockReturnValue(mockGenerator());

            const response = await chatManager.sendMessage('Show me a function');

            expect(response.suggestions).toBeDefined();
            expect(response.suggestions?.some(s => s.includes('code'))).toBe(true);
        });

        it('should extract actions from response', async () => {
            async function* mockGenerator() {
                yield 'Here is the code:\n```typescript\nfunction hello() { console.log("Hello"); }\n```';
            }
            mockLLMService.generateResponse.mockReturnValue(mockGenerator());

            const response = await chatManager.sendMessage('Create a hello function');

            expect(response.actions).toBeDefined();
            expect(response.actions?.some(a => a.type === 'create_file')).toBe(true);
        });
    });

    describe('history management', () => {
        it('should maintain conversation history', () => {
            const message1 = createUserMessage('First message');
            const message2 = createUserMessage('Second message');

            chatManager.addMessage(message1);
            chatManager.addMessage(message2);

            const history = chatManager.getHistory();
            expect(history).toHaveLength(2);
            expect(history[0]).toBe(message1);
            expect(history[1]).toBe(message2);
        });

        it('should clear history', () => {
            chatManager.addMessage(createUserMessage('Test message'));
            expect(chatManager.getHistory()).toHaveLength(1);

            chatManager.clearHistory();
            expect(chatManager.getHistory()).toHaveLength(0);
        });

        it('should get last N messages', () => {
            for (let i = 0; i < 5; i++) {
                chatManager.addMessage(createUserMessage(`Message ${i}`));
            }

            const lastThree = chatManager.getLastMessages(3);
            expect(lastThree).toHaveLength(3);
            expect(lastThree[0].content).toBe('Message 2');
            expect(lastThree[2].content).toBe('Message 4');
        });

        it('should trim history when it exceeds max length', async () => {
            const shortConfig = { maxHistoryLength: 3 };
            const shortHistoryManager = new ChatManager(
                mockLLMService,
                mockContextManager,
                mockSafetyFilter,
                mockSpecProvider,
                shortConfig
            );

            // Setup mocks for successful message processing
            mockSafetyFilter.validateRequest.mockReturnValue({
                isValid: true,
                errors: [],
                warnings: [],
            });

            mockContextManager.getCurrentContext.mockResolvedValue({});
            mockSpecProvider.getRelevantContext.mockResolvedValue('');
            mockLLMService.optimizeForTokenLimits.mockReturnValue({
                optimizedPrompt: 'test',
                optimizedContext: 'test',
                optimizedHistory: [],
                tokenInfo: { original: 10, optimized: 10, saved: 0 },
            });

            async function* mockGenerator() {
                yield 'Response';
            }
            mockLLMService.generateResponse.mockReturnValue(mockGenerator());
            mockLLMService.estimateTokens.mockReturnValue(10);
            mockSafetyFilter.sanitizeResponse.mockImplementation(text => text);

            // Send messages to exceed max length
            await shortHistoryManager.sendMessage('Message 1');
            await shortHistoryManager.sendMessage('Message 2');
            await shortHistoryManager.sendMessage('Message 3'); // This should trigger trimming

            const history = shortHistoryManager.getHistory();
            expect(history.length).toBeLessThanOrEqual(3);
        });
    });
});