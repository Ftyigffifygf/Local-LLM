import { SpecInfo } from '../types';
import { FileSystemAdapter } from './ContextManager';

export interface SpecFile {
    path: string;
    type: 'requirements' | 'design' | 'tasks';
    content: string;
    lastModified: Date;
}

export interface DocumentationFile {
    path: string;
    type: 'readme' | 'api' | 'guide' | 'changelog';
    content: string;
    lastModified: Date;
}

export class SpecContextProvider {
    private specCache = new Map<string, { spec: SpecFile; timestamp: Date }>();
    private docCache = new Map<string, { doc: DocumentationFile; timestamp: Date }>();
    private readonly CACHE_TTL = 60000; // 1 minute

    constructor(private fileSystem: FileSystemAdapter) { }

    async findActiveSpec(): Promise<SpecInfo | null> {
        try {
            const specDirs = await this.findSpecDirectories();

            if (specDirs.length === 0) {
                return null;
            }

            // For now, return the first spec found
            // In a real implementation, this might detect the "current" spec based on context
            const activeSpecDir = specDirs[0];
            const specName = activeSpecDir.split('/').pop() || 'unknown';

            const phase = await this.detectSpecPhase(activeSpecDir);
            const context = await this.buildSpecContext(activeSpecDir);

            return {
                currentSpec: specName,
                phase,
                context,
            };
        } catch (error) {
            console.error('Error finding active spec:', error);
            return null;
        }
    }

    async getSpecFiles(specName: string): Promise<SpecFile[]> {
        try {
            const specDir = `.kiro/specs/${specName}`;
            const files = await this.fileSystem.listFiles(specDir);
            const specFiles: SpecFile[] = [];

            for (const file of files) {
                if (file.endsWith('.md')) {
                    const cached = this.specCache.get(file);
                    if (cached && Date.now() - cached.timestamp.getTime() < this.CACHE_TTL) {
                        specFiles.push(cached.spec);
                        continue;
                    }

                    try {
                        const content = await this.fileSystem.readFile(file);
                        const stats = await this.fileSystem.getFileStats(file);

                        const specFile: SpecFile = {
                            path: file,
                            type: this.detectSpecFileType(file),
                            content,
                            lastModified: stats.modified,
                        };

                        this.specCache.set(file, { spec: specFile, timestamp: new Date() });
                        specFiles.push(specFile);
                    } catch (error) {
                        console.warn(`Could not read spec file ${file}:`, error);
                    }
                }
            }

            return specFiles;
        } catch (error) {
            console.error(`Error getting spec files for ${specName}:`, error);
            return [];
        }
    }

    async getDocumentationFiles(): Promise<DocumentationFile[]> {
        try {
            const projectFiles = await this.fileSystem.listFiles('.');
            const docFiles: DocumentationFile[] = [];

            const documentationPatterns = [
                { pattern: /^README\.(md|txt)$/i, type: 'readme' as const },
                { pattern: /^API\.(md|txt)$/i, type: 'api' as const },
                { pattern: /^CHANGELOG\.(md|txt)$/i, type: 'changelog' as const },
                { pattern: /docs\/.*\.(md|txt)$/i, type: 'guide' as const },
            ];

            for (const file of projectFiles) {
                const fileName = file.split('/').pop() || '';

                for (const { pattern, type } of documentationPatterns) {
                    if (pattern.test(file) || pattern.test(fileName)) {
                        const cached = this.docCache.get(file);
                        if (cached && Date.now() - cached.timestamp.getTime() < this.CACHE_TTL) {
                            docFiles.push(cached.doc);
                            continue;
                        }

                        try {
                            const content = await this.fileSystem.readFile(file);
                            const stats = await this.fileSystem.getFileStats(file);

                            const docFile: DocumentationFile = {
                                path: file,
                                type,
                                content: this.truncateContent(content, 5000),
                                lastModified: stats.modified,
                            };

                            this.docCache.set(file, { doc: docFile, timestamp: new Date() });
                            docFiles.push(docFile);
                            break; // Only match first pattern
                        } catch (error) {
                            console.warn(`Could not read documentation file ${file}:`, error);
                        }
                    }
                }
            }

            return docFiles;
        } catch (error) {
            console.error('Error getting documentation files:', error);
            return [];
        }
    }

    async buildSpecContext(specDir: string): Promise<string> {
        const specName = specDir.split('/').pop() || 'unknown';
        const specFiles = await this.getSpecFiles(specName);

        if (specFiles.length === 0) {
            return `No spec files found for ${specName}`;
        }

        const sections: string[] = [];
        sections.push(`# Spec Context: ${specName}`);
        sections.push('');

        // Sort files by type priority
        const typePriority = { requirements: 1, design: 2, tasks: 3 };
        specFiles.sort((a, b) => typePriority[a.type] - typePriority[b.type]);

        for (const specFile of specFiles) {
            sections.push(`## ${specFile.type.toUpperCase()}`);
            sections.push(`*From: ${specFile.path}*`);
            sections.push('');
            sections.push(this.truncateContent(specFile.content, 2000));
            sections.push('');
        }

        return sections.join('\n');
    }

    async buildDocumentationContext(): Promise<string> {
        const docFiles = await this.getDocumentationFiles();

        if (docFiles.length === 0) {
            return 'No documentation files found';
        }

        const sections: string[] = [];
        sections.push('# Documentation Context');
        sections.push('');

        // Sort by type priority
        const typePriority = { readme: 1, api: 2, guide: 3, changelog: 4 };
        docFiles.sort((a, b) => typePriority[a.type] - typePriority[b.type]);

        for (const docFile of docFiles) {
            sections.push(`## ${docFile.type.toUpperCase()}: ${docFile.path}`);
            sections.push('');
            sections.push(this.truncateContent(docFile.content, 1500));
            sections.push('');
        }

        return sections.join('\n');
    }

    async getRelevantContext(query: string): Promise<string> {
        const sections: string[] = [];

        // Check if query is spec-related
        if (this.isSpecRelated(query)) {
            const activeSpec = await this.findActiveSpec();
            if (activeSpec && activeSpec.currentSpec) {
                const specContext = await this.buildSpecContext(`.kiro/specs/${activeSpec.currentSpec}`);
                sections.push(specContext);
            }
        }

        // Always include basic documentation context
        const docContext = await this.buildDocumentationContext();
        sections.push(docContext);

        return sections.join('\n\n---\n\n');
    }

    private async findSpecDirectories(): Promise<string[]> {
        try {
            const kiroDir = '.kiro/specs';
            const entries = await this.fileSystem.listFiles(kiroDir);

            // Filter for directories (in a real implementation, you'd check if they're directories)
            return entries.filter(entry => !entry.includes('.'));
        } catch (error) {
            return [];
        }
    }

    private async detectSpecPhase(specDir: string): Promise<'requirements' | 'design' | 'tasks' | undefined> {
        try {
            const files = await this.fileSystem.listFiles(specDir);

            if (files.some(f => f.includes('tasks.md'))) {
                return 'tasks';
            } else if (files.some(f => f.includes('design.md'))) {
                return 'design';
            } else if (files.some(f => f.includes('requirements.md'))) {
                return 'requirements';
            }

            return undefined;
        } catch (error) {
            return undefined;
        }
    }

    private detectSpecFileType(filePath: string): 'requirements' | 'design' | 'tasks' {
        const fileName = filePath.toLowerCase();

        if (fileName.includes('requirements')) {
            return 'requirements';
        } else if (fileName.includes('design')) {
            return 'design';
        } else if (fileName.includes('tasks')) {
            return 'tasks';
        }

        // Default to requirements if unclear
        return 'requirements';
    }

    private isSpecRelated(query: string): boolean {
        const specKeywords = [
            'spec', 'specification', 'requirements', 'design', 'tasks',
            'feature', 'implementation', 'plan', 'workflow',
            'create spec', 'new spec', 'update spec'
        ];

        const lowerQuery = query.toLowerCase();
        return specKeywords.some(keyword => lowerQuery.includes(keyword));
    }

    private truncateContent(content: string, maxLength: number): string {
        if (content.length <= maxLength) return content;

        // Try to truncate at a natural break point
        const truncated = content.substring(0, maxLength);
        const lastNewline = truncated.lastIndexOf('\n');
        const lastSentence = truncated.lastIndexOf('.');

        const breakPoint = Math.max(lastNewline, lastSentence);
        if (breakPoint > maxLength * 0.8) {
            return content.substring(0, breakPoint + 1) + '\n\n... [truncated]';
        }

        return truncated + '\n\n... [truncated]';
    }
}