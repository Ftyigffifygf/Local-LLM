import { IContextManager, ContextData } from '../interfaces/IContextManager';
import { ContextType, ChatContext, GitInfo } from '../types';

export interface FileSystemAdapter {
    readFile(path: string): Promise<string>;
    listFiles(directory: string): Promise<string[]>;
    getFileStats(path: string): Promise<{ size: number; modified: Date }>;
    watchFile(path: string, callback: (content: string) => void): void;
}

export interface GitAdapter {
    getCurrentBranch(): Promise<string>;
    hasUncommittedChanges(): Promise<boolean>;
    getRecentCommits(count?: number): Promise<string[]>;
    getDiff(): Promise<string>;
}

export interface WorkspaceAdapter {
    getActiveFile(): Promise<string | undefined>;
    getSelectedText(): Promise<string | undefined>;
    getOpenFiles(): Promise<string[]>;
    getProjectRoot(): Promise<string>;
}

export class ContextManager implements IContextManager {
    private contextCache = new Map<string, { data: ContextData; timestamp: Date }>();
    private readonly CACHE_TTL = 30000; // 30 seconds
    private changeCallbacks: ((context: ChatContext) => void)[] = [];

    constructor(
        private fileSystem: FileSystemAdapter,
        private git: GitAdapter,
        private workspace: WorkspaceAdapter
    ) { }

    async gatherContext(type: ContextType): Promise<ContextData> {
        const cacheKey = `${type}_${Date.now()}`;
        const cached = this.contextCache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp.getTime() < this.CACHE_TTL) {
            return cached.data;
        }

        let contextData: ContextData;

        switch (type) {
            case 'file':
                contextData = await this.gatherFileContext();
                break;
            case 'workspace':
                contextData = await this.gatherWorkspaceContext();
                break;
            case 'git':
                contextData = await this.gatherGitContext();
                break;
            case 'spec':
                contextData = await this.gatherSpecContext();
                break;
            case 'selection':
                contextData = await this.gatherSelectionContext();
                break;
            default:
                throw new Error(`Unknown context type: ${type}`);
        }

        this.contextCache.set(cacheKey, { data: contextData, timestamp: new Date() });
        return contextData;
    }

    formatForLLM(context: ContextData): string {
        const sections: string[] = [];

        sections.push(`## ${context.type.toUpperCase()} Context`);
        sections.push(`Generated: ${context.timestamp.toISOString()}`);
        sections.push('');

        if (context.metadata.activeFile) {
            sections.push(`**Active File:** ${context.metadata.activeFile}`);
        }

        if (context.metadata.selectedText) {
            sections.push(`**Selected Text:**`);
            sections.push('```');
            sections.push(context.metadata.selectedText);
            sections.push('```');
            sections.push('');
        }

        if (context.content) {
            sections.push('**Content:**');
            sections.push(context.content);
        }

        return sections.join('\n');
    }

    async getCurrentContext(): Promise<ChatContext> {
        try {
            const [activeFile, selectedText, workspaceFiles, gitStatus] = await Promise.allSettled([
                this.workspace.getActiveFile(),
                this.workspace.getSelectedText(),
                this.workspace.getOpenFiles(),
                this.gatherGitInfo(),
            ]);

            const context: ChatContext = {};

            if (activeFile.status === 'fulfilled' && activeFile.value) {
                context.activeFile = activeFile.value;
            }

            if (selectedText.status === 'fulfilled' && selectedText.value) {
                context.selectedText = selectedText.value;
            }

            if (workspaceFiles.status === 'fulfilled') {
                context.workspaceFiles = workspaceFiles.value;
            }

            if (gitStatus.status === 'fulfilled') {
                context.gitStatus = gitStatus.value;
            }

            // Try to gather spec context
            try {
                const specContext = await this.gatherSpecInfo();
                if (specContext) {
                    context.specContext = specContext;
                }
            } catch (error) {
                // Spec context is optional, don't fail if unavailable
                console.debug('Spec context unavailable:', error);
            }

            return context;
        } catch (error) {
            console.error('Error gathering current context:', error);
            return {};
        }
    }

    watchForChanges(callback: (context: ChatContext) => void): void {
        this.changeCallbacks.push(callback);

        // Set up file watchers for active file changes
        this.workspace.getActiveFile().then(activeFile => {
            if (activeFile) {
                this.fileSystem.watchFile(activeFile, () => {
                    this.getCurrentContext().then(callback);
                });
            }
        });
    }

    private async gatherFileContext(): Promise<ContextData> {
        const activeFile = await this.workspace.getActiveFile();

        if (!activeFile) {
            return {
                type: 'file',
                content: 'No active file',
                metadata: {},
                timestamp: new Date(),
            };
        }

        try {
            const [content, stats] = await Promise.all([
                this.fileSystem.readFile(activeFile),
                this.fileSystem.getFileStats(activeFile),
            ]);

            return {
                type: 'file',
                content: this.truncateContent(content, 5000),
                metadata: {
                    activeFile,
                    fileSize: stats.size,
                    lastModified: stats.modified,
                    language: this.detectLanguage(activeFile),
                },
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                type: 'file',
                content: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                metadata: { activeFile, error: true },
                timestamp: new Date(),
            };
        }
    }

    private async gatherWorkspaceContext(): Promise<ContextData> {
        try {
            const [projectRoot, openFiles] = await Promise.all([
                this.workspace.getProjectRoot(),
                this.workspace.getOpenFiles(),
            ]);

            const projectFiles = await this.fileSystem.listFiles(projectRoot);
            const importantFiles = projectFiles.filter(file =>
                file.includes('package.json') ||
                file.includes('README') ||
                file.includes('tsconfig') ||
                file.includes('.gitignore')
            );

            return {
                type: 'workspace',
                content: this.formatWorkspaceStructure(projectFiles.slice(0, 50)), // Limit to 50 files
                metadata: {
                    projectRoot,
                    openFiles: openFiles.slice(0, 10), // Limit open files
                    importantFiles,
                    totalFiles: projectFiles.length,
                },
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                type: 'workspace',
                content: `Error gathering workspace context: ${error instanceof Error ? error.message : 'Unknown error'}`,
                metadata: { error: true },
                timestamp: new Date(),
            };
        }
    }

    private async gatherGitContext(): Promise<ContextData> {
        try {
            const gitInfo = await this.gatherGitInfo();
            const diff = await this.git.getDiff();

            return {
                type: 'git',
                content: this.truncateContent(diff, 3000),
                metadata: {
                    branch: gitInfo.branch,
                    hasChanges: gitInfo.hasChanges,
                    recentCommits: gitInfo.recentCommits,
                },
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                type: 'git',
                content: `Git context unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
                metadata: { error: true },
                timestamp: new Date(),
            };
        }
    }

    private async gatherSpecContext(): Promise<ContextData> {
        try {
            const projectRoot = await this.workspace.getProjectRoot();
            const specFiles = await this.fileSystem.listFiles(`${projectRoot}/.kiro/specs`);

            let specContent = '';
            const specInfo: any = {};

            for (const specFile of specFiles.slice(0, 5)) { // Limit to 5 specs
                if (specFile.endsWith('.md')) {
                    try {
                        const content = await this.fileSystem.readFile(specFile);
                        specContent += `\n## ${specFile}\n${this.truncateContent(content, 1000)}\n`;

                        if (specFile.includes('requirements')) {
                            specInfo.hasRequirements = true;
                        } else if (specFile.includes('design')) {
                            specInfo.hasDesign = true;
                        } else if (specFile.includes('tasks')) {
                            specInfo.hasTasks = true;
                        }
                    } catch (error) {
                        console.debug(`Could not read spec file ${specFile}:`, error);
                    }
                }
            }

            return {
                type: 'spec',
                content: specContent || 'No spec files found',
                metadata: {
                    specFiles: specFiles.length,
                    ...specInfo,
                },
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                type: 'spec',
                content: `Spec context unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
                metadata: { error: true },
                timestamp: new Date(),
            };
        }
    }

    private async gatherSelectionContext(): Promise<ContextData> {
        try {
            const selectedText = await this.workspace.getSelectedText();
            const activeFile = await this.workspace.getActiveFile();

            if (!selectedText) {
                return {
                    type: 'selection',
                    content: 'No text selected',
                    metadata: { activeFile },
                    timestamp: new Date(),
                };
            }

            return {
                type: 'selection',
                content: selectedText,
                metadata: {
                    activeFile,
                    selectionLength: selectedText.length,
                    language: activeFile ? this.detectLanguage(activeFile) : undefined,
                },
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                type: 'selection',
                content: `Error gathering selection: ${error instanceof Error ? error.message : 'Unknown error'}`,
                metadata: { error: true },
                timestamp: new Date(),
            };
        }
    }

    private async gatherGitInfo(): Promise<GitInfo> {
        const [branch, hasChanges, recentCommits] = await Promise.all([
            this.git.getCurrentBranch(),
            this.git.hasUncommittedChanges(),
            this.git.getRecentCommits(5),
        ]);

        return { branch, hasChanges, recentCommits };
    }

    private async gatherSpecInfo() {
        try {
            const { SpecContextProvider } = await import('./SpecContextProvider');
            const specProvider = new SpecContextProvider(this.fileSystem);
            return await specProvider.findActiveSpec();
        } catch (error) {
            console.debug('Spec context provider unavailable:', error);
            return {
                currentSpec: undefined,
                phase: undefined,
                context: undefined,
            };
        }
    }

    private detectLanguage(filePath: string): string {
        const extension = filePath.split('.').pop()?.toLowerCase();
        const languageMap: Record<string, string> = {
            'ts': 'typescript',
            'js': 'javascript',
            'tsx': 'typescript',
            'jsx': 'javascript',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'cs': 'csharp',
            'rb': 'ruby',
            'rs': 'rust',
            'go': 'go',
            'php': 'php',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'md': 'markdown',
            'json': 'json',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
        };

        return languageMap[extension || ''] || 'text';
    }

    private truncateContent(content: string, maxLength: number): string {
        if (content.length <= maxLength) return content;
        return content.substring(0, maxLength - 20) + '\n... [truncated]';
    }

    private formatWorkspaceStructure(files: string[]): string {
        const tree: Record<string, any> = {};

        files.forEach(file => {
            const parts = file.split('/');
            let current = tree;

            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    current[part] = null; // File
                } else {
                    current[part] = current[part] || {}; // Directory
                    current = current[part];
                }
            });
        });

        return this.renderTree(tree, 0);
    }

    private renderTree(tree: Record<string, any>, depth: number): string {
        const indent = '  '.repeat(depth);
        const lines: string[] = [];

        Object.keys(tree).sort().forEach(key => {
            if (tree[key] === null) {
                lines.push(`${indent}📄 ${key}`);
            } else {
                lines.push(`${indent}📁 ${key}/`);
                if (depth < 3) { // Limit depth to prevent huge output
                    lines.push(this.renderTree(tree[key], depth + 1));
                }
            }
        });

        return lines.join('\n');
    }
}