import { SpecContextProvider } from '../services/SpecContextProvider';
import { FileSystemAdapter } from '../services/ContextManager';

describe('SpecContextProvider', () => {
    let specProvider: SpecContextProvider;
    let mockFileSystem: jest.Mocked<FileSystemAdapter>;

    beforeEach(() => {
        mockFileSystem = {
            readFile: jest.fn(),
            listFiles: jest.fn(),
            getFileStats: jest.fn(),
            watchFile: jest.fn(),
        };

        specProvider = new SpecContextProvider(mockFileSystem);
    });

    describe('findActiveSpec', () => {
        it('should find active spec', async () => {
            mockFileSystem.listFiles
                .mockResolvedValueOnce(['user-auth']) // spec directories
                .mockResolvedValueOnce(['requirements.md', 'design.md', 'tasks.md']); // spec files

            const result = await specProvider.findActiveSpec();

            expect(result).toEqual({
                currentSpec: 'user-auth',
                phase: 'tasks',
                context: expect.any(String),
            });
        });

        it('should return null if no specs found', async () => {
            mockFileSystem.listFiles.mockResolvedValueOnce([]);

            const result = await specProvider.findActiveSpec();

            expect(result).toBeNull();
        });

        it('should handle errors gracefully', async () => {
            mockFileSystem.listFiles.mockRejectedValueOnce(new Error('Directory not found'));

            const result = await specProvider.findActiveSpec();

            expect(result).toBeNull();
        });
    });

    describe('getSpecFiles', () => {
        it('should get spec files for a spec', async () => {
            mockFileSystem.listFiles.mockResolvedValueOnce([
                '.kiro/specs/user-auth/requirements.md',
                '.kiro/specs/user-auth/design.md',
            ]);

            mockFileSystem.readFile
                .mockResolvedValueOnce('# Requirements\nUser authentication requirements...')
                .mockResolvedValueOnce('# Design\nAuthentication system design...');

            mockFileSystem.getFileStats
                .mockResolvedValue({ size: 1000, modified: new Date() });

            const result = await specProvider.getSpecFiles('user-auth');

            expect(result).toHaveLength(2);
            expect(result[0].type).toBe('requirements');
            expect(result[1].type).toBe('design');
            expect(result[0].content).toContain('User authentication requirements');
        });

        it('should handle missing spec files', async () => {
            mockFileSystem.listFiles.mockResolvedValueOnce([]);

            const result = await specProvider.getSpecFiles('nonexistent');

            expect(result).toHaveLength(0);
        });
    });

    describe('getDocumentationFiles', () => {
        it('should find documentation files', async () => {
            mockFileSystem.listFiles.mockResolvedValueOnce([
                'README.md',
                'API.md',
                'docs/guide.md',
                'src/main.ts', // Should be ignored
            ]);

            mockFileSystem.readFile
                .mockResolvedValueOnce('# Project README\nThis is the main project...')
                .mockResolvedValueOnce('# API Documentation\nAPI endpoints...')
                .mockResolvedValueOnce('# User Guide\nHow to use the system...');

            mockFileSystem.getFileStats
                .mockResolvedValue({ size: 500, modified: new Date() });

            const result = await specProvider.getDocumentationFiles();

            expect(result).toHaveLength(3);
            expect(result.find(f => f.type === 'readme')).toBeDefined();
            expect(result.find(f => f.type === 'api')).toBeDefined();
            expect(result.find(f => f.type === 'guide')).toBeDefined();
        });
    });

    describe('buildSpecContext', () => {
        it('should build comprehensive spec context', async () => {
            mockFileSystem.listFiles.mockResolvedValueOnce([
                '.kiro/specs/user-auth/requirements.md',
                '.kiro/specs/user-auth/design.md',
            ]);

            mockFileSystem.readFile
                .mockResolvedValueOnce('# Requirements\nDetailed requirements...')
                .mockResolvedValueOnce('# Design\nSystem design...');

            mockFileSystem.getFileStats
                .mockResolvedValue({ size: 1000, modified: new Date() });

            const result = await specProvider.buildSpecContext('.kiro/specs/user-auth');

            expect(result).toContain('# Spec Context: user-auth');
            expect(result).toContain('## REQUIREMENTS');
            expect(result).toContain('## DESIGN');
            expect(result).toContain('Detailed requirements');
            expect(result).toContain('System design');
        });
    });

    describe('getRelevantContext', () => {
        it('should return spec context for spec-related queries', async () => {
            mockFileSystem.listFiles
                .mockResolvedValueOnce(['user-auth']) // spec directories
                .mockResolvedValueOnce(['requirements.md']) // spec files
                .mockResolvedValueOnce(['README.md']); // project files

            mockFileSystem.readFile
                .mockResolvedValueOnce('# Requirements\nSpec requirements...')
                .mockResolvedValueOnce('# Project\nProject documentation...');

            mockFileSystem.getFileStats
                .mockResolvedValue({ size: 1000, modified: new Date() });

            const result = await specProvider.getRelevantContext('create a new spec for user authentication');

            expect(result).toContain('Spec Context');
            expect(result).toContain('Documentation Context');
            expect(result).toContain('Spec requirements');
        });

        it('should return only documentation for non-spec queries', async () => {
            mockFileSystem.listFiles
                .mockResolvedValueOnce([]) // no spec directories
                .mockResolvedValueOnce(['README.md']); // project files

            mockFileSystem.readFile
                .mockResolvedValueOnce('# Project\nProject documentation...');

            mockFileSystem.getFileStats
                .mockResolvedValue({ size: 1000, modified: new Date() });

            const result = await specProvider.getRelevantContext('how do I install dependencies?');

            expect(result).toContain('Documentation Context');
            expect(result).not.toContain('Spec Context');
        });
    });
});