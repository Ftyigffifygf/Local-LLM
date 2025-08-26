import { ValidationResult } from '../types';

export interface ISafetyFilter {
    validateRequest(message: string): ValidationResult;
    sanitizeResponse(response: string): string;
    checkForMaliciousCode(code: string): boolean;
    filterSensitiveInfo(text: string): string;
}

export interface SafetyRule {
    name: string;
    pattern: RegExp;
    severity: 'error' | 'warning';
    message: string;
}