import { ChatMessage, ValidationResult, SerializedChatMessage } from '../types';
import { createValidationResult, isValidMessageRole } from '../utils/validationUtils';

export class MessageValidator {
    private static readonly MAX_CONTENT_LENGTH = 50000;
    private static readonly MIN_CONTENT_LENGTH = 1;
    private static readonly MAX_ID_LENGTH = 100;

    static validateChatMessage(message: ChatMessage): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate ID
        if (!message.id || typeof message.id !== 'string') {
            errors.push('Message ID is required and must be a string');
        } else if (message.id.length > this.MAX_ID_LENGTH) {
            errors.push(`Message ID cannot exceed ${this.MAX_ID_LENGTH} characters`);
        }

        // Validate role
        if (!message.role || !isValidMessageRole(message.role)) {
            errors.push('Message role must be either "user" or "assistant"');
        }

        // Validate content
        if (!message.content || typeof message.content !== 'string') {
            errors.push('Message content is required and must be a string');
        } else {
            const contentLength = message.content.trim().length;
            if (contentLength < this.MIN_CONTENT_LENGTH) {
                errors.push('Message content cannot be empty');
            } else if (contentLength > this.MAX_CONTENT_LENGTH) {
                errors.push(`Message content cannot exceed ${this.MAX_CONTENT_LENGTH} characters`);
            } else if (contentLength > 10000) {
                warnings.push('Message content is very long and may affect performance');
            }
        }

        // Validate timestamp
        if (!message.timestamp || !(message.timestamp instanceof Date)) {
            errors.push('Message timestamp is required and must be a Date object');
        } else if (message.timestamp > new Date()) {
            warnings.push('Message timestamp is in the future');
        }

        return createValidationResult(errors.length === 0, errors, warnings);
    }

    static validateMessageContent(content: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!content || typeof content !== 'string') {
            errors.push('Content must be a non-empty string');
            return createValidationResult(false, errors, warnings);
        }

        const trimmedContent = content.trim();
        if (trimmedContent.length === 0) {
            errors.push('Content cannot be empty or only whitespace');
        }

        if (trimmedContent.length > this.MAX_CONTENT_LENGTH) {
            errors.push(`Content cannot exceed ${this.MAX_CONTENT_LENGTH} characters`);
        }

        // Check for potentially problematic content
        if (this.containsSuspiciousPatterns(content)) {
            warnings.push('Content contains patterns that may need review');
        }

        return createValidationResult(errors.length === 0, errors, warnings);
    }

    static serializeMessage(message: ChatMessage): SerializedChatMessage {
        return {
            ...message,
            timestamp: message.timestamp.toISOString(),
        };
    }

    static deserializeMessage(serialized: SerializedChatMessage): ChatMessage {
        return {
            ...serialized,
            timestamp: new Date(serialized.timestamp),
        };
    }

    private static containsSuspiciousPatterns(content: string): boolean {
        const suspiciousPatterns = [
            /rm\s+-rf\s+\//, // Dangerous file deletion
            /sudo\s+/, // Elevated privileges
            /eval\s*\(/, // Code evaluation
            /exec\s*\(/, // Code execution
            /<script[^>]*>/, // Script injection
        ];

        return suspiciousPatterns.some(pattern => pattern.test(content));
    }
}