import { MessageValidator, ContextValidator } from '../validation';
import { ChatMessage, ChatContext } from '../types';
import { createUserMessage, createAssistantMessage } from '../utils/messageUtils';

describe('MessageValidator', () => {
    describe('validateChatMessage', () => {
        it('should validate a correct message', () => {
            const message = createUserMessage('Hello, world!');
            const result = MessageValidator.validateChatMessage(message);

            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject message with invalid role', () => {
            const message = {
                ...createUserMessage('Hello'),
                role: 'invalid' as any,
            };
            const result = MessageValidator.validateChatMessage(message);

            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Message role must be either "user" or "assistant"');
        });

        it('should reject message with empty content', () => {
            const message = createUserMessage('   ');
            const result = MessageValidator.validateChatMessage(message);

            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Message content cannot be empty');
        });

        it('should warn about very long content', () => {
            const longContent = 'a'.repeat(15000);
            const message = createUserMessage(longContent);
            const result = MessageValidator.validateChatMessage(message);

            expect(result.isValid).toBe(true);
            expect(result.warnings).toContain('Message content is very long and may affect performance');
        });

        it('should reject message with content exceeding max length', () => {
            const tooLongContent = 'a'.repeat(60000);
            const message = createUserMessage(tooLongContent);
            const result = MessageValidator.validateChatMessage(message);

            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Message content cannot exceed 50000 characters');
        });
    });

    describe('validateMessageContent', () => {
        it('should validate normal content', () => {
            const result = MessageValidator.validateMessageContent('Hello, how are you?');

            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should warn about suspicious patterns', () => {
            const result = MessageValidator.validateMessageContent('rm -rf /');

            expect(result.isValid).toBe(true);
            expect(result.warnings).toContain('Content contains patterns that may need review');
        });
    });

    describe('serialization', () => {
        it('should serialize and deserialize messages correctly', () => {
            const original = createUserMessage('Test message');
            const serialized = MessageValidator.serializeMessage(original);
            const deserialized = MessageValidator.deserializeMessage(serialized);

            expect(deserialized.id).toBe(original.id);
            expect(deserialized.content).toBe(original.content);
            expect(deserialized.timestamp.getTime()).toBe(original.timestamp.getTime());
        });
    });
});

describe('ContextValidator', () => {
    describe('validateChatContext', () => {
        it('should validate empty context', () => {
            const context: ChatContext = {};
            const result = ContextValidator.validateChatContext(context);

            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate context with all fields', () => {
            const context: ChatContext = {
                activeFile: 'src/main.ts',
                selectedText: 'console.log("hello");',
                workspaceFiles: ['src/main.ts', 'package.json'],
                gitStatus: {
                    branch: 'main',
                    hasChanges: true,
                    recentCommits: ['abc123', 'def456'],
                },
                specContext: {
                    currentSpec: 'user-auth',
                    phase: 'design',
                    context: 'Working on authentication system',
                },
            };

            const result = ContextValidator.validateChatContext(context);

            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid activeFile', () => {
            const context: ChatContext = {
                activeFile: 123 as any,
            };

            const result = ContextValidator.validateChatContext(context);

            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('activeFile must be a string');
        });

        it('should warn about too many workspace files', () => {
            const manyFiles = Array.from({ length: 1500 }, (_, i) => `file${i}.ts`);
            const context: ChatContext = {
                workspaceFiles: manyFiles,
            };

            const result = ContextValidator.validateChatContext(context);

            expect(result.isValid).toBe(true);
            expect(result.warnings.some(w => w.includes('may impact performance'))).toBe(true);
        });
    });
});