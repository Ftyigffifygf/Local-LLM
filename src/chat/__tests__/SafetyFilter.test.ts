import { SafetyFilter } from '../services/SafetyFilter';

describe('SafetyFilter', () => {
    let safetyFilter: SafetyFilter;

    beforeEach(() => {
        safetyFilter = new SafetyFilter();
    });

    describe('validateRequest', () => {
        it('should allow safe messages', () => {
            const result = safetyFilter.validateRequest('How do I create a React component?');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should block dangerous file operations', () => {
            const result = safetyFilter.validateRequest('rm -rf /');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Dangerous file system operations are not allowed');
        });

        it('should block privilege escalation', () => {
            const result = safetyFilter.validateRequest('sudo rm file.txt');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Privilege escalation commands are not allowed');
        });

        it('should block code injection', () => {
            const result = safetyFilter.validateRequest('eval("malicious code")');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Code injection patterns detected');
        });

        it('should warn about network access', () => {
            const result = safetyFilter.validateRequest('curl http://example.com');
            expect(result.isValid).toBe(true);
            expect(result.warnings).toContain('Network access detected - review for security');
        });

        it('should detect sensitive information', () => {
            const result = safetyFilter.validateRequest('My email is user@example.com');
            expect(result.isValid).toBe(true);
            expect(result.warnings.some(w => w.includes('email addresses'))).toBe(true);
        });
    });

    describe('checkForMaliciousCode', () => {
        it('should detect malicious patterns', () => {
            expect(safetyFilter.checkForMaliciousCode('eval("alert(1)")')).toBe(true);
            expect(safetyFilter.checkForMaliciousCode('<script>alert(1)</script>')).toBe(true);
            expect(safetyFilter.checkForMaliciousCode('document.cookie')).toBe(true);
        });

        it('should allow safe code', () => {
            expect(safetyFilter.checkForMaliciousCode('console.log("hello")')).toBe(false);
            expect(safetyFilter.checkForMaliciousCode('function add(a, b) { return a + b; }')).toBe(false);
        });
    });

    describe('sanitizeResponse', () => {
        it('should remove script tags', () => {
            const input = 'Here is some code: <script>alert("xss")</script>';
            const result = safetyFilter.sanitizeResponse(input);
            expect(result).toContain('[SCRIPT_REMOVED]');
            expect(result).not.toContain('<script>');
        });

        it('should sanitize javascript protocols', () => {
            const input = 'Click here: javascript:alert(1)';
            const result = safetyFilter.sanitizeResponse(input);
            expect(result).toContain('javascript_removed:');
        });

        it('should filter sensitive information', () => {
            const input = 'Contact me at user@example.com or call 555-123-4567';
            const result = safetyFilter.sanitizeResponse(input);
            expect(result).toContain('[EMAIL_REDACTED]');
            expect(result).toContain('[PHONE_REDACTED]');
        });

        it('should sanitize dangerous commands in code blocks', () => {
            const input = '```bash\nrm -rf /\nsudo reboot\n```';
            const result = safetyFilter.sanitizeResponse(input);
            expect(result).toContain('# DANGEROUS COMMAND REMOVED');
            expect(result).toContain('# PRIVILEGE ESCALATION REMOVED');
        });
    });

    describe('filterSensitiveInfo', () => {
        it('should redact API keys', () => {
            const input = 'sk-1234567890abcdef1234567890abcdef';
            const result = safetyFilter.filterSensitiveInfo(input);
            expect(result).toContain('[API_KEY_REDACTED]');
        });

        it('should redact credentials in URLs', () => {
            const input = 'https://user:password@example.com/api';
            const result = safetyFilter.filterSensitiveInfo(input);
            expect(result).toContain('[CREDENTIALS_REDACTED]');
        });

        it('should preserve safe content', () => {
            const input = 'This is a safe message with no sensitive data';
            const result = safetyFilter.filterSensitiveInfo(input);
            expect(result).toBe(input);
        });
    });
});