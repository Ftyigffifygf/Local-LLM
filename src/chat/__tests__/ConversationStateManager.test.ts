import { ConversationStateManager, StorageAdapter } from '../services/ConversationStateManager';
import { createUserMessage, createAssistantMessage } from '../utils/messageUtils';

describe('ConversationStateManager', () => {
    let stateManager: ConversationStateManager;
    let mockStorage: jest.Mocked<StorageAdapter>;

    const mockConfig = {
        maxHistoryLength: 50,
        maxTokensPerMessage: 4000,
        enableStreaming: true,
        safetyLevel: 'moderate' as const,
        autoSaveHistory: true,
    };

    beforeEach(() => {
        mockStorage = {
            save: jest.fn(),
            load: jest.fn(),
            delete: jest.fn(),
            list: jest.fn(),
        };

        stateManager = new ConversationStateManager(mockStorage, mockConfig);
    });

    describe('conversation management', () => {
        it('should create a new conversation', async () => {
            const conversation = await stateManager.createNewConversation('Test Chat');

            expect(conversation.title).toBe('Test Chat');
            expect(conversation.messages).toHaveLength(0);
            expect(conversation.id).toBeDefined();
            expect(mockStorage.save).toHaveBeenCalled();
        });

        it('should generate default title if none provided', async () => {
            const conversation = await stateManager.createNewConversation();

            expect(conversation.title).toMatch(/Chat \d+\/\d+\/\d+ \d+:\d+/);
        });

        it('should save and load conversations', async () => {
            const originalConversation = await stateManager.createNewConversation('Test');

            // Mock storage load
            const serializedData = JSON.stringify({
                id: originalConversation.id,
                title: originalConversation.title,
                messages: [],
                createdAt: originalConversation.createdAt.toISOString(),
                lastModified: originalConversation.lastModified.toISOString(),
                metadata: originalConversation.metadata,
            });

            mockStorage.load.mockResolvedValue(serializedData);

            const loadedConversation = await stateManager.loadConversation(originalConversation.id);

            expect(loadedConversation).toBeDefined();
            expect(loadedConversation?.id).toBe(originalConversation.id);
            expect(loadedConversation?.title).toBe(originalConversation.title);
        });

        it('should return null for non-existent conversation', async () => {
            mockStorage.load.mockResolvedValue(null);

            const result = await stateManager.loadConversation('nonexistent');

            expect(result).toBeNull();
        });

        it('should delete conversations', async () => {
            const conversation = await stateManager.createNewConversation();

            await stateManager.deleteConversation(conversation.id);

            expect(mockStorage.delete).toHaveBeenCalledWith(`kiro_chat_conversation_${conversation.id}`);
        });
    });

    describe('message management', () => {
        beforeEach(async () => {
            await stateManager.createNewConversation('Test');
        });

        it('should add messages to current conversation', () => {
            const message = createUserMessage('Hello');

            stateManager.addMessage(message);

            const messages = stateManager.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0]).toBe(message);
        });

        it('should update conversation metadata when adding messages', () => {
            const message = createUserMessage('Hello');
            message.metadata = { tokenCount: 10 };

            stateManager.addMessage(message);

            const conversation = stateManager.getCurrentConversation();
            expect(conversation?.metadata.messageCount).toBe(1);
            expect(conversation?.metadata.totalTokens).toBe(10);
        });

        it('should clear conversation messages', async () => {
            stateManager.addMessage(createUserMessage('Hello'));
            stateManager.addMessage(createAssistantMessage('Hi there'));

            stateManager.clearCurrentConversation();

            const messages = stateManager.getMessages();
            expect(messages).toHaveLength(0);
        });

        it('should trim conversation history', async () => {
            // Add more messages than the limit
            for (let i = 0; i < 60; i++) {
                stateManager.addMessage(createUserMessage(`Message ${i}`));
            }

            await stateManager.trimConversationHistory(10);

            const messages = stateManager.getMessages();
            expect(messages).toHaveLength(10);
            expect(messages[0].content).toBe('Message 50'); // Should keep the most recent
            expect(messages[9].content).toBe('Message 59');
        });
    });

    describe('conversation listing', () => {
        it('should list all conversations', async () => {
            const conv1Data = JSON.stringify({
                id: 'conv1',
                title: 'First Chat',
                messages: [],
                createdAt: new Date('2023-01-01').toISOString(),
                lastModified: new Date('2023-01-01').toISOString(),
                metadata: { messageCount: 0, totalTokens: 0 },
            });

            const conv2Data = JSON.stringify({
                id: 'conv2',
                title: 'Second Chat',
                messages: [],
                createdAt: new Date('2023-01-02').toISOString(),
                lastModified: new Date('2023-01-02').toISOString(),
                metadata: { messageCount: 0, totalTokens: 0 },
            });

            mockStorage.list.mockResolvedValue(['kiro_chat_conversation_conv1', 'kiro_chat_conversation_conv2']);
            mockStorage.load
                .mockResolvedValueOnce(conv1Data)
                .mockResolvedValueOnce(conv2Data);

            const conversations = await stateManager.listConversations();

            expect(conversations).toHaveLength(2);
            expect(conversations[0].title).toBe('Second Chat'); // Most recent first
            expect(conversations[1].title).toBe('First Chat');
        });
    });

    describe('import/export', () => {
        beforeEach(async () => {
            await stateManager.createNewConversation('Test');
            stateManager.addMessage(createUserMessage('Hello'));
            stateManager.addMessage(createAssistantMessage('Hi there'));
        });

        it('should export conversation', async () => {
            const exported = await stateManager.exportConversation();
            const data = JSON.parse(exported);

            expect(data.title).toBe('Test');
            expect(data.messages).toHaveLength(2);
            expect(data.messages[0].role).toBe('user');
            expect(data.messages[0].content).toBe('Hello');
        });

        it('should import conversation', async () => {
            const importData = JSON.stringify({
                title: 'Imported Chat',
                messages: [
                    { role: 'user', content: 'Imported message', timestamp: new Date().toISOString() },
                ],
            });

            const imported = await stateManager.importConversation(importData);

            expect(imported.title).toBe('Imported Chat');
            expect(imported.messages).toHaveLength(1);
            expect(imported.messages[0].content).toBe('Imported message');
            expect(mockStorage.save).toHaveBeenCalled();
        });

        it('should handle invalid import data', async () => {
            const invalidData = 'invalid json';

            await expect(stateManager.importConversation(invalidData)).rejects.toThrow('Invalid conversation data');
        });
    });
});