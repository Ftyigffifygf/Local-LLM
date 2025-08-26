import { ContextManager, FileSystemAdapter, GitAdapter, WorkspaceAdapter } from '../services/ContextManager';

describe('ContextManager', () => {
    let contextManager: ContextManager;
    let mockFileSystem: jest.Mocked<FileSystemAdapter>;
    let mockGit: jest.Mocked<GitAdapter>;
    let mockWorkspace: jest.Mocked<WorkspaceAdapter>;

    beforeEach(() => {
        mockFileSystem = {
            readFile: jest.fn(),
            listFiles: jest.fn(),
            getFileStats: jest.fn(),
            watchFile: jest.fn(),
        };

        mockGit = {
            getCurrentBranch: jest.fn(),
            hasUncommittedChanges: jest.fn(),
            getRecentCommits: jest.fn(),
            getDiff: jest.fn(),
        };

        mockWorkspace = {
            getActiveFile: jest.fn(),
            getSelectedText: jest.fn(),
            getOpenFiles: jest.fn(),
            getProjectRoot: jest.fn(),
        };

        contextManager = new ContextManager(mockFileSystem, mockGit, mockWorkspace);
    });

    describe('gatherContext', () => {
        it('should gather file context', async () => {
            mockWorkspace.getActiveFile.mockResolvedValue('src/main.ts');
            mockFileSystem.readFile.mockResolvedValue('console.log("hello");');
            mockFileSystem.getFileStats.mockResolvedValue({
                size: 100,
                modified: new Date(),
            });

            const context = await contextManager.gatherContext('file');

            expect(context.type).toBe('file');
            expect(context.content).toContain('console.log("hello");');
            expect(context.metadata.activeFile).toBe('src/main.ts');
            expect(context.metadata.language).toBe('typescript');
        });

        it('should handle file read errors', async () => {
            mockWorkspace.getActiveFile.mockResolvedValue('src/main.ts');
            mockFileSystem.readFile.mockRejectedValue(new Error('File not found'));
            mockFileSystem.getFileStats.mockRejectedValue(new Error('File not found'));

            const context = await contextManager.gatherContext('file');

            expect(context.type).toBe('file');
            expect(context.content).toContain('Error reading file');
            expect(context.metadata.error).toBe(true);
        });

        it('should gather workspace context', async () => {
            mockWorkspace.getProjectRoot.mockResolvedValue('/project');
            mockWorkspace.getOpenFiles.mockResolvedValue(['src/main.ts', 'package.json']);
            mockFileSystem.listFiles.mockResolvedValue([
                'src/main.ts',
                'src/utils.ts',
                'package.json',
                'README.md',
            ]);

            const context = await contextManager.gatherContext('workspace');

            expect(context.type).toBe('workspace');
            expect(context.metadata.projectRoot).toBe('/project');
            expect(context.metadata.openFiles).toEqual(['src/main.ts', 'package.json']);
            expect(context.metadata.totalFiles).toBe(4);
        });

        it('should gather git context', async () => {
            mockGit.getCurrentBranch.mockResolvedValue('main');
            mockGit.hasUncommittedChanges.mockResolvedValue(true);
            mockGit.getRecentCommits.mockResolvedValue(['abc123', 'def456']);
            mockGit.getDiff.mockResolvedValue('+ added line\n- removed line');

            const context = await contextManager.gatherContext('git');

            expect(context.type).toBe('git');
            expect(context.content).toContain('added line');
            expect(context.metadata.branch).toBe('main');
            expect(context.metadata.hasChanges).toBe(true);
        });

        it('should gather selection context', async () => {
            mockWorkspace.getSelectedText.mockResolvedValue('const x = 5;');
            mockWorkspace.getActiveFile.mockResolvedValue('src/main.ts');

            const context = await contextManager.gatherContext('selection');

            expect(context.type).toBe('selection');
            expect(context.content).toBe('const x = 5;');
            expect(context.metadata.selectionLength).toBe(11);
            expect(context.metadata.language).toBe('typescript');
        });
    });

    describe('formatForLLM', () => {
        it('should format context data for LLM consumption', () => {
            const contextData = {
                type: 'file' as const,
                content: 'console.log("test");',
                metadata: {
                    activeFile: 'src/main.ts',
                    selectedText: 'console.log',
                },
                timestamp: new Date('2023-01-01T00:00:00Z'),
            };

            const formatted = contextManager.formatForLLM(contextData);

            expect(formatted).toContain('## FILE Context');
            expect(formatted).toContain('**Active File:** src/main.ts');
            expect(formatted).toContain('**Selected Text:**');
            expect(formatted).toContain('console.log("test");');
        });
    });

    describe('getCurrentContext', () => {
        it('should gather complete current context', async () => {
            mockWorkspace.getActiveFile.mockResolvedValue('src/main.ts');
            mockWorkspace.getSelectedText.mockResolvedValue('selected code');
            mockWorkspace.getOpenFiles.mockResolvedValue(['src/main.ts']);
            mockGit.getCurrentBranch.mockResolvedValue('main');
            mockGit.hasUncommittedChanges.mockResolvedValue(false);
            mockGit.getRecentCommits.mockResolvedValue(['abc123']);

            const context = await contextManager.getCurrentContext();

            expect(context.activeFile).toBe('src/main.ts');
            expect(context.selectedText).toBe('selected code');
            expect(context.workspaceFiles).toEqual(['src/main.ts']);
            expect(context.gitStatus?.branch).toBe('main');
            expect(context.gitStatus?.hasChanges).toBe(false);
        });

        it('should handle partial failures gracefully', async () => {
            mockWorkspace.getActiveFile.mockResolvedValue('src/main.ts');
            mockWorkspace.getSelectedText.mockRejectedValue(new Error('No selection'));
            mockWorkspace.getOpenFiles.mockResolvedValue(['src/main.ts']);
            mockGit.getCurrentBranch.mockRejectedValue(new Error('Not a git repo'));

            const context = await contextManager.getCurrentContext();

            expect(context.activeFile).toBe('src/main.ts');
            expect(context.selectedText).toBeUndefined();
            expect(context.workspaceFiles).toEqual(['src/main.ts']);
            expect(context.gitStatus).toBeUndefined();
        });
    });

    describe('watchForChanges', () => {
        it('should set up file watchers', async () => {
            mockWorkspace.getActiveFile.mockResolvedValue('src/main.ts');

            const callback = jest.fn();
            contextManager.watchForChanges(callback);

            await new Promise(resolve => setTimeout(resolve, 0)); // Wait for async setup

            expect(mockFileSystem.watchFile).toHaveBeenCalledWith('src/main.ts', expect.any(Function));
        });
    });
});