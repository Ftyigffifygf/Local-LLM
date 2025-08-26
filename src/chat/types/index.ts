// Core data models for the conversational LLM feature

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    context?: ChatContext;
    metadata?: MessageMetadata;
}

export interface ChatContext {
    activeFile?: string;
    selectedText?: string;
    workspaceFiles?: string[];
    gitStatus?: GitInfo;
    specContext?: SpecInfo;
}

export interface ChatResponse {
    message: ChatMessage;
    suggestions?: string[];
    actions?: ChatAction[];
    error?: ErrorInfo;
}

export interface MessageMetadata {
    tokenCount?: number;
    processingTime?: number;
    model?: string;
}

export interface GitInfo {
    branch: string;
    hasChanges: boolean;
    recentCommits?: string[];
}

export interface SpecInfo {
    currentSpec?: string;
    phase?: 'requirements' | 'design' | 'tasks';
    context?: string;
}

export interface ChatAction {
    type: 'create_file' | 'modify_file' | 'run_command' | 'create_spec';
    payload: any;
    description: string;
}

export interface ErrorInfo {
    type: 'network' | 'auth' | 'validation' | 'system';
    message: string;
    code?: string;
    retryable: boolean;
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export type ContextType = 'file' | 'workspace' | 'git' | 'spec' | 'selection';
//
 Serialization interfaces for persistence
export interface SerializedChatMessage {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: string; // ISO string for serialization
        context?: ChatContext;
        metadata?: MessageMetadata;
    }

// Configuration interfaces
export interface ChatConfig {
    maxHistoryLength: number;
    maxTokensPerMessage: number;
    enableStreaming: boolean;
    safetyLevel: 'strict' | 'moderate' | 'permissive';
    autoSaveHistory: boolean;
}

// Event interfaces for chat system
export interface ChatEvent {
    type: 'message_sent' | 'message_received' | 'error_occurred' | 'context_changed';
    timestamp: Date;
    data: any;
}

// Streaming response interface
export interface StreamingResponse {
    id: string;
    content: string;
    isComplete: boolean;
    error?: ErrorInfo;
}