import type { MobileRisk } from './types';
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export declare function formatDateTime(value?: string | null): string;
export declare function formatDate(value?: string | null): string;
export declare function formatReminderType(value: string): string;
export declare function formatStatus(value?: string): {
    label: string;
    tone: Tone;
};
export declare function formatReviewPriority(value?: string): {
    label: string;
    tone: Tone;
};
export declare function getRiskTone(score: number): Tone;
export declare function formatFrequency(value: string): string;
export declare function formatAdministrationTime(value: string): string;
export declare function formatEventType(value: string): string;
export declare function formatRiskDirection(value: string): string;
export declare function buildRiskActions(risk: MobileRisk): string[];
export {};
