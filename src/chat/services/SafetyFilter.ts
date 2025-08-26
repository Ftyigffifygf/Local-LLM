import { ISafetyFilter, SafetyRule } from '../interfaces/ISafetyFilter';
import { ValidationResult } from '../types';
import { createValidationResult } from '../utils/validationUtils';

export class SafetyFilter implements ISafetyFilter {
    private readonly rules: SafetyRule[];
    private readonly sensitivePatterns: RegExp[];
    private readonly maliciousCodePatterns: RegExp[];

    constructor() {
        this.rules = this.initializeRules();
        this.sensitivePatterns = this.initializeSensitivePatterns();
        this.maliciousCodePatterns = this.initializeMaliciousCodePatterns();
    }

    validateRequest(message: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check against safety rules
        for (const rule of this.rules) {
            if (rule.pattern.test(message)) {
                if (rule.severity === 'error') {
                    errors.push(rule.message);
                } else {
                    warnings.push(rule.message);
                }
            }
        }

        // Check for malicious code
        if (this.checkForMaliciousCode(message)) {
            errors.push('Message contains potentially malicious code patterns');
        }

        // Check for sensitive information
        const sensitiveInfo = this.detectSensitiveInfo(message);
        if (sensitiveInfo.length > 0) {
            warnings.push(`Message may contain sensitive information: ${sensitiveInfo.join(', ')}`);
        }

        return createValidationResult(errors.length === 0, errors, warnings);
    }

    sanitizeResponse(response: string): string {
        let sanitized = response;

        // Remove potential script injections
        sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gis, '[SCRIPT_REMOVED]');
        sanitized = sanitized.replace(/javascript:/gi, 'javascript_removed:');
        sanitized = sanitized.replace(/on\w+\s*=/gi, 'event_removed=');

        // Filter sensitive information
        sanitized = this.filterSensitiveInfo(sanitized);

        // Remove dangerous shell commands in code blocks
        sanitized = this.sanitizeCodeBlocks(sanitized);

        return sanitized;
    }

    checkForMaliciousCode(code: string): boolean {
        return this.maliciousCodePatterns.some(pattern => pattern.test(code));
    }

    filterSensitiveInfo(text: string): string {
        let filtered = text;

        // Replace potential API keys
        filtered = filtered.replace(/\b[A-Za-z0-9]{32,}\b/g, '[API_KEY_REDACTED]');

        // Replace potential passwords in URLs
        filtered = filtered.replace(/:\/\/[^:]+:[^@]+@/g, '://[CREDENTIALS_REDACTED]@');

        // Replace email addresses
        filtered = filtered.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]');

        // Replace potential phone numbers
        filtered = filtered.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE_REDACTED]');

        return filtered;
    }

    private initializeRules(): SafetyRule[] {
        return [
            {
                name: 'dangerous_file_operations',
                pattern: /rm\s+-rf\s+[\/\\]|del\s+\/[sq]\s+\*|format\s+c:/i,
                severity: 'error',
                message: 'Dangerous file system operations are not allowed'
            },
            {
                name: 'privilege_escalation',
                pattern: /sudo\s+|runas\s+|su\s+-/i,
                severity: 'error',
                message: 'Privilege escalation commands are not allowed'
            },
            {
                name: 'code_injection',
                pattern: /eval\s*\(|exec\s*\(|system\s*\(|shell_exec\s*\(/i,
                severity: 'error',
                message: 'Code injection patterns detected'
            },
            {
                name: 'network_access',
                pattern: /curl\s+|wget\s+|fetch\s*\(.*http|XMLHttpRequest/i,
                severity: 'warning',
                message: 'Network access detected - review for security'
            },
            {
                name: 'file_access',
                pattern: /open\s*\(.*['"\/\\]|readFile\s*\(|writeFile\s*\(/i,
                severity: 'warning',
                message: 'File access operations detected'
            },
            {
                name: 'database_operations',
                pattern: /DROP\s+TABLE|DELETE\s+FROM.*WHERE\s+1=1|TRUNCATE\s+TABLE/i,
                severity: 'error',
                message: 'Dangerous database operations detected'
            }
        ];
    }

    private initializeSensitivePatterns(): RegExp[] {
        return [
            /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
            /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone numbers
            /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, // Credit card numbers
            /\b\d{3}-\d{2}-\d{4}\b/, // SSN format
            /password\s*[:=]\s*['"][^'"]+['"]/i, // Password assignments
            /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i, // API keys
            /token\s*[:=]\s*['"][^'"]+['"]/i, // Tokens
        ];
    }

    private initializeMaliciousCodePatterns(): RegExp[] {
        return [
            /rm\s+-rf\s+[\/\\]/, // Dangerous file deletion
            /sudo\s+/, // Privilege escalation
            /eval\s*\(/, // Code evaluation
            /exec\s*\(/, // Code execution
            /<script[^>]*>/i, // Script injection
            /javascript:/i, // JavaScript protocol
            /on\w+\s*=/i, // Event handlers
            /document\.cookie/i, // Cookie access
            /window\.location/i, // Location manipulation
            /\.innerHTML\s*=/i, // HTML injection
            /system\s*\(/i, // System calls
            /shell_exec\s*\(/i, // Shell execution
            /passthru\s*\(/i, // Command execution
            /proc_open\s*\(/i, // Process execution
        ];
    }

    private detectSensitiveInfo(text: string): string[] {
        const detected: string[] = [];

        for (const pattern of this.sensitivePatterns) {
            if (pattern.test(text)) {
                if (pattern.source.includes('email')) detected.push('email addresses');
                else if (pattern.source.includes('phone')) detected.push('phone numbers');
                else if (pattern.source.includes('credit')) detected.push('credit card numbers');
                else if (pattern.source.includes('password')) detected.push('passwords');
                else if (pattern.source.includes('api')) detected.push('API keys');
                else if (pattern.source.includes('token')) detected.push('tokens');
                else detected.push('sensitive data');
            }
        }

        return [...new Set(detected)]; // Remove duplicates
    }

    private sanitizeCodeBlocks(text: string): string {
        // Find code blocks and sanitize dangerous commands within them
        return text.replace(/```[\s\S]*?```/g, (codeBlock) => {
            let sanitized = codeBlock;

            // Replace dangerous commands with comments
            sanitized = sanitized.replace(/rm\s+-rf\s+[\/\\]/g, '# rm -rf / # DANGEROUS COMMAND REMOVED');
            sanitized = sanitized.replace(/sudo\s+/g, '# sudo # PRIVILEGE ESCALATION REMOVED ');
            sanitized = sanitized.replace(/format\s+c:/gi, '# format c: # DANGEROUS COMMAND REMOVED');

            return sanitized;
        });
    }
}