import { TokenManager } from '../services/TokenManager';
import { createUserMessage, createAssistantMessage } from '../utils/messageUtils';

describe('TokenManager', () => {
    let tokenManager: TokenManager;

    beforeEach(() => {
        tokenManager = new TokenManager(4096, 8192);
    });

    describe('estimateTokens', () => {
        it('should estimate tokens correctly', () => {
            expect(tokenManager.estimateTokens('Hello world')).toBe(3); // 11 chars / 4 = 2.75 -> 3
            expect(tokenManager.estimateTokens('')).toBe(0);
            expect(tokenManager.estimateTokens('a')).toBe(1);
        });
    });

    describe('calculateMessageTokens', () => {
        it('should calculate tokens for simple message', () => {
            const message = createUserMessage('Hello world');
            const tokens = tokenManager.calculateMessageTokens(message);
            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBe(7); // 4 base + 3 content tokens
        });

        it('should include context tokens', () => {
            const message = createUserMessage('Hello');
            message.context = {
                activeFile: 'src/main.ts',
                selectedText: 'console.log("test");',
            };

            const tokens = tokenManager.calculateMessageTokens(message);
            expect(tokens).toBeGreaterThan(5); // Should include context
        });
    });

    describe('optimizePrompt', () => {
        it('should return original if within limits', () => {
            const result = tokenManager.optimizePrompt('Short prompt', 'Short context');
            expect(result.optimizedPrompt).toBe('Short prompt');
            expect(result.tokensSaved).toBe(0);
            expect(result.removedContent).toHaveLength(0);
        });

        it('should optimize long context', () => {
            const longContext = 'a'.repeat(20000); // Very long context
            const result = tokenManager.optimizePrompt('Short prompt', longContext);

            expect(result.tokensSaved).toBeGreaterThan(0);
            expect(result.removedContent.length).toBeGreaterThan(0);
        });
    });

    describe('optimizeConversationHistory', () => {
        it('should keep all messages if within limits', () => {
            const messages = [
                createUserMessage('Hello'),
                createAssistantMessage('Hi there'),
                createUserMessage('How are you?'),
            ];

            const optimized = tokenManager.optimizeConversationHistory(messages);
            expect(optimized).toHaveLength(3);
        });

        it('should truncate old messages when over limit', () => {
            const messages = Array.from({ length: 100 }, (_, i) =>
                i % 2 === 0
                    ? createUserMessage(`User message ${i}`.repeat(100))
                    : createAssistantMessage(`Assistant message ${i}`.repeat(100))
            );

            const optimized = tokenManager.optimizeConversationHistory(messages, 1000);
            expect(optimized.length).toBeLessThan(messages.length);
            expect(optimized[optimized.length - 1]).toBe(messages[messages.length - 1]); // Last message preserved
        });

        it('should handle empty message array', () => {
            const optimized = tokenManager.optimizeConversationHistory([]);
            expect(optimized).toHaveLength(0);
        });
    });

    describe('validateTokenLimits', () => {
        it('should validate normal usage', () => {
            const result = tokenManager.validateTokenLimits(
                'Normal prompt',
                'Normal context',
                [createUserMessage('Hello')]
            );

            expect(result.isValid).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it('should detect token limit issues', () => {
            const longPrompt = 'a'.repeat(10000);
            const longContext = 'b'.repeat(10000);
            const longHistory = Array.from({ length: 50 }, () =>
                createUserMessage('c'.repeat(1000))
            );

            const result = tokenManager.validateTokenLimits(longPrompt, longContext, longHistory);

            expect(result.isValid).toBe(false);
            expect(result.issues.length).toBeGreaterThan(0);
            expect(result.suggestions.length).toBeGreaterThan(0);
        });

        it('should provide helpful suggestions', () => {
            const veryLongPrompt = 'a'.repeat(20000);
            const result = tokenManager.validateTokenLimits(veryLongPrompt, '', []);

            expect(result.suggestions).toContain('Consider breaking down the request into smaller parts');
        });
    });
});