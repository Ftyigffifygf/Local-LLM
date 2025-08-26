import { ValidationResult } from '../types';

export function createValidationResult(
    isValid: boolean,
    errors: string[] = [],
    warnings: string[] = []
): ValidationResult {
    return { isValid, errors, warnings };
}

export function validateMessageContent(content: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content || content.trim().length === 0) {
        errors.push('Message content cannot be empty');
    }

    if (content.length > 10000) {
        warnings.push('Message is very long and may be truncated');
    }

    return createValidationResult(errors.length === 0, errors, warnings);
}

export function isValidMessageRole(role: string): role is 'user' | 'assistant' {
    return role === 'user' || role === 'assistant';
}