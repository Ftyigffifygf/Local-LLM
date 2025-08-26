import { ChatContext, ValidationResult, GitInfo, SpecInfo } from '../types';
import { createValidationResult } from '../utils/validationUtils';

export class ContextValidator {
    private static readonly MAX_FILE_PATH_LENGTH = 500;
    private static readonly MAX_SELECTED_TEXT_LENGTH = 10000;
    private static readonly MAX_WORKSPACE_FILES = 1000;

    static validateChatContext(context: ChatContext): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate activeFile
        if (context.activeFile !== undefined) {
            if (typeof context.activeFile !== 'string') {
                errors.push('activeFile must be a string');
            } else if (context.activeFile.length > this.MAX_FILE_PATH_LENGTH) {
                errors.push(`activeFile path cannot exceed ${this.MAX_FILE_PATH_LENGTH} characters`);
            }
        }

        // Validate selectedText
        if (context.selectedText !== undefined) {
            if (typeof context.selectedText !== 'string') {
                errors.push('selectedText must be a string');
            } else if (context.selectedText.length > this.MAX_SELECTED_TEXT_LENGTH) {
                warnings.push(`selectedText is very long (${context.selectedText.length} chars) and may be truncated`);
            }
        }

        // Validate workspaceFiles
        if (context.workspaceFiles !== undefined) {
            if (!Array.isArray(context.workspaceFiles)) {
                errors.push('workspaceFiles must be an array');
            } else {
                if (context.workspaceFiles.length > this.MAX_WORKSPACE_FILES) {
                    warnings.push(`workspaceFiles contains ${context.workspaceFiles.length} files, which may impact performance`);
                }

                const invalidFiles = context.workspaceFiles.filter(file =>
                    typeof file !== 'string' || file.length > this.MAX_FILE_PATH_LENGTH
                );
                if (invalidFiles.length > 0) {
                    errors.push(`workspaceFiles contains ${invalidFiles.length} invalid file paths`);
                }
            }
        }

        // Validate gitStatus
        if (context.gitStatus !== undefined) {
            const gitValidation = this.validateGitInfo(context.gitStatus);
            errors.push(...gitValidation.errors);
            warnings.push(...gitValidation.warnings);
        }

        // Validate specContext
        if (context.specContext !== undefined) {
            const specValidation = this.validateSpecInfo(context.specContext);
            errors.push(...specValidation.errors);
            warnings.push(...specValidation.warnings);
        }

        return createValidationResult(errors.length === 0, errors, warnings);
    }

    private static validateGitInfo(gitInfo: GitInfo): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (typeof gitInfo.branch !== 'string' || gitInfo.branch.trim().length === 0) {
            errors.push('Git branch name is required and must be a non-empty string');
        }

        if (typeof gitInfo.hasChanges !== 'boolean') {
            errors.push('Git hasChanges must be a boolean');
        }

        if (gitInfo.recentCommits !== undefined) {
            if (!Array.isArray(gitInfo.recentCommits)) {
                errors.push('recentCommits must be an array');
            } else if (gitInfo.recentCommits.length > 50) {
                warnings.push('Large number of recent commits may impact performance');
            }
        }

        return createValidationResult(errors.length === 0, errors, warnings);
    }

    private static validateSpecInfo(specInfo: SpecInfo): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (specInfo.currentSpec !== undefined && typeof specInfo.currentSpec !== 'string') {
            errors.push('currentSpec must be a string');
        }

        if (specInfo.phase !== undefined) {
            const validPhases = ['requirements', 'design', 'tasks'];
            if (!validPhases.includes(specInfo.phase)) {
                errors.push(`phase must be one of: ${validPhases.join(', ')}`);
            }
        }

        if (specInfo.context !== undefined && typeof specInfo.context !== 'string') {
            errors.push('spec context must be a string');
        }

        return createValidationResult(errors.length === 0, errors, warnings);
    }
}