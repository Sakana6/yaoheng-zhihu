import type { MobileJointEvent, MobileMedication, MobileReminder, MobileRisk } from '../lib/types';
type DemoStage = 'idle' | 'medication' | 'recorded' | 'inquiry' | 'risk' | 'report';
interface DoctorSummaryState {
    generated: boolean;
    title: string;
    lines: string[];
    downloadUrl: string;
}
interface MvpState {
    stage: DemoStage;
    medications: MobileMedication[];
    reminders: MobileReminder[];
    recordSeeded: boolean;
    inquiryCompleted: boolean;
    jointEvents: MobileJointEvent[];
    risk: MobileRisk | null;
    doctorSummary: DoctorSummaryState;
}
export declare const useMvpStore: import("pinia").StoreDefinition<"mobile-mvp", Pick<{
    state: import("vue").Ref<{
        stage: DemoStage;
        medications: {
            id: number;
            genericName: string;
            brandName?: string | undefined;
            dose: string;
            frequency: string;
            administrationTime: string;
            startDate: string;
            status: string;
        }[];
        reminders: {
            reminderId: string;
            reminderType: string;
            plannedAt: string;
            title: string;
            status: string;
            medicationIds: number[];
            medicationNames: string[];
            voicePrompt: string;
            followUpPrompt: string;
        }[];
        recordSeeded: boolean;
        inquiryCompleted: boolean;
        jointEvents: {
            eventType: string;
            eventLabel?: string | undefined;
            eventDate?: string | undefined;
            timeWindowStart?: string | undefined;
            timeWindowEnd?: string | undefined;
            severity: number;
            evidence: Record<string, unknown>;
            riskDirections: import("../lib/types").RiskDirection[];
        }[];
        risk: {
            deintensificationScore: number;
            interactionScore: number;
            behaviorScore: number;
            jointEventScore: number;
            reviewPriority: import("../lib/types").ReviewPriority;
            reasons: string[];
        } | null;
        doctorSummary: {
            generated: boolean;
            title: string;
            lines: string[];
            downloadUrl: string;
        };
    }, MvpState | {
        stage: DemoStage;
        medications: {
            id: number;
            genericName: string;
            brandName?: string | undefined;
            dose: string;
            frequency: string;
            administrationTime: string;
            startDate: string;
            status: string;
        }[];
        reminders: {
            reminderId: string;
            reminderType: string;
            plannedAt: string;
            title: string;
            status: string;
            medicationIds: number[];
            medicationNames: string[];
            voicePrompt: string;
            followUpPrompt: string;
        }[];
        recordSeeded: boolean;
        inquiryCompleted: boolean;
        jointEvents: {
            eventType: string;
            eventLabel?: string | undefined;
            eventDate?: string | undefined;
            timeWindowStart?: string | undefined;
            timeWindowEnd?: string | undefined;
            severity: number;
            evidence: Record<string, unknown>;
            riskDirections: import("../lib/types").RiskDirection[];
        }[];
        risk: {
            deintensificationScore: number;
            interactionScore: number;
            behaviorScore: number;
            jointEventScore: number;
            reviewPriority: import("../lib/types").ReviewPriority;
            reasons: string[];
        } | null;
        doctorSummary: {
            generated: boolean;
            title: string;
            lines: string[];
            downloadUrl: string;
        };
    }>;
    progressLabel: import("vue").ComputedRef<"医生摘要已生成" | "风险结果已生成" | "追问已完成" | "事件已记录" | "药历已确认" | "等待开始">;
    syncMedicationData: (medications: MobileMedication[], reminders?: MobileReminder[]) => void;
    addMedication: (medication: MobileMedication) => void;
    updateMedication: (medication: MobileMedication) => void;
    deleteMedication: (medicationId: number) => void;
    addReminder: (reminder: MobileReminder) => void;
    updateReminder: (reminder: MobileReminder) => void;
    deleteReminder: (reminderId: string) => void;
    updateReminderStatus: (reminderId: string, status: string) => void;
    seedMvpRecord: () => void;
    completeInquiry: () => void;
    generateRisk: () => void;
    generateDoctorSummary: () => void;
    resetFlow: () => void;
}, "state">, Pick<{
    state: import("vue").Ref<{
        stage: DemoStage;
        medications: {
            id: number;
            genericName: string;
            brandName?: string | undefined;
            dose: string;
            frequency: string;
            administrationTime: string;
            startDate: string;
            status: string;
        }[];
        reminders: {
            reminderId: string;
            reminderType: string;
            plannedAt: string;
            title: string;
            status: string;
            medicationIds: number[];
            medicationNames: string[];
            voicePrompt: string;
            followUpPrompt: string;
        }[];
        recordSeeded: boolean;
        inquiryCompleted: boolean;
        jointEvents: {
            eventType: string;
            eventLabel?: string | undefined;
            eventDate?: string | undefined;
            timeWindowStart?: string | undefined;
            timeWindowEnd?: string | undefined;
            severity: number;
            evidence: Record<string, unknown>;
            riskDirections: import("../lib/types").RiskDirection[];
        }[];
        risk: {
            deintensificationScore: number;
            interactionScore: number;
            behaviorScore: number;
            jointEventScore: number;
            reviewPriority: import("../lib/types").ReviewPriority;
            reasons: string[];
        } | null;
        doctorSummary: {
            generated: boolean;
            title: string;
            lines: string[];
            downloadUrl: string;
        };
    }, MvpState | {
        stage: DemoStage;
        medications: {
            id: number;
            genericName: string;
            brandName?: string | undefined;
            dose: string;
            frequency: string;
            administrationTime: string;
            startDate: string;
            status: string;
        }[];
        reminders: {
            reminderId: string;
            reminderType: string;
            plannedAt: string;
            title: string;
            status: string;
            medicationIds: number[];
            medicationNames: string[];
            voicePrompt: string;
            followUpPrompt: string;
        }[];
        recordSeeded: boolean;
        inquiryCompleted: boolean;
        jointEvents: {
            eventType: string;
            eventLabel?: string | undefined;
            eventDate?: string | undefined;
            timeWindowStart?: string | undefined;
            timeWindowEnd?: string | undefined;
            severity: number;
            evidence: Record<string, unknown>;
            riskDirections: import("../lib/types").RiskDirection[];
        }[];
        risk: {
            deintensificationScore: number;
            interactionScore: number;
            behaviorScore: number;
            jointEventScore: number;
            reviewPriority: import("../lib/types").ReviewPriority;
            reasons: string[];
        } | null;
        doctorSummary: {
            generated: boolean;
            title: string;
            lines: string[];
            downloadUrl: string;
        };
    }>;
    progressLabel: import("vue").ComputedRef<"医生摘要已生成" | "风险结果已生成" | "追问已完成" | "事件已记录" | "药历已确认" | "等待开始">;
    syncMedicationData: (medications: MobileMedication[], reminders?: MobileReminder[]) => void;
    addMedication: (medication: MobileMedication) => void;
    updateMedication: (medication: MobileMedication) => void;
    deleteMedication: (medicationId: number) => void;
    addReminder: (reminder: MobileReminder) => void;
    updateReminder: (reminder: MobileReminder) => void;
    deleteReminder: (reminderId: string) => void;
    updateReminderStatus: (reminderId: string, status: string) => void;
    seedMvpRecord: () => void;
    completeInquiry: () => void;
    generateRisk: () => void;
    generateDoctorSummary: () => void;
    resetFlow: () => void;
}, "progressLabel">, Pick<{
    state: import("vue").Ref<{
        stage: DemoStage;
        medications: {
            id: number;
            genericName: string;
            brandName?: string | undefined;
            dose: string;
            frequency: string;
            administrationTime: string;
            startDate: string;
            status: string;
        }[];
        reminders: {
            reminderId: string;
            reminderType: string;
            plannedAt: string;
            title: string;
            status: string;
            medicationIds: number[];
            medicationNames: string[];
            voicePrompt: string;
            followUpPrompt: string;
        }[];
        recordSeeded: boolean;
        inquiryCompleted: boolean;
        jointEvents: {
            eventType: string;
            eventLabel?: string | undefined;
            eventDate?: string | undefined;
            timeWindowStart?: string | undefined;
            timeWindowEnd?: string | undefined;
            severity: number;
            evidence: Record<string, unknown>;
            riskDirections: import("../lib/types").RiskDirection[];
        }[];
        risk: {
            deintensificationScore: number;
            interactionScore: number;
            behaviorScore: number;
            jointEventScore: number;
            reviewPriority: import("../lib/types").ReviewPriority;
            reasons: string[];
        } | null;
        doctorSummary: {
            generated: boolean;
            title: string;
            lines: string[];
            downloadUrl: string;
        };
    }, MvpState | {
        stage: DemoStage;
        medications: {
            id: number;
            genericName: string;
            brandName?: string | undefined;
            dose: string;
            frequency: string;
            administrationTime: string;
            startDate: string;
            status: string;
        }[];
        reminders: {
            reminderId: string;
            reminderType: string;
            plannedAt: string;
            title: string;
            status: string;
            medicationIds: number[];
            medicationNames: string[];
            voicePrompt: string;
            followUpPrompt: string;
        }[];
        recordSeeded: boolean;
        inquiryCompleted: boolean;
        jointEvents: {
            eventType: string;
            eventLabel?: string | undefined;
            eventDate?: string | undefined;
            timeWindowStart?: string | undefined;
            timeWindowEnd?: string | undefined;
            severity: number;
            evidence: Record<string, unknown>;
            riskDirections: import("../lib/types").RiskDirection[];
        }[];
        risk: {
            deintensificationScore: number;
            interactionScore: number;
            behaviorScore: number;
            jointEventScore: number;
            reviewPriority: import("../lib/types").ReviewPriority;
            reasons: string[];
        } | null;
        doctorSummary: {
            generated: boolean;
            title: string;
            lines: string[];
            downloadUrl: string;
        };
    }>;
    progressLabel: import("vue").ComputedRef<"医生摘要已生成" | "风险结果已生成" | "追问已完成" | "事件已记录" | "药历已确认" | "等待开始">;
    syncMedicationData: (medications: MobileMedication[], reminders?: MobileReminder[]) => void;
    addMedication: (medication: MobileMedication) => void;
    updateMedication: (medication: MobileMedication) => void;
    deleteMedication: (medicationId: number) => void;
    addReminder: (reminder: MobileReminder) => void;
    updateReminder: (reminder: MobileReminder) => void;
    deleteReminder: (reminderId: string) => void;
    updateReminderStatus: (reminderId: string, status: string) => void;
    seedMvpRecord: () => void;
    completeInquiry: () => void;
    generateRisk: () => void;
    generateDoctorSummary: () => void;
    resetFlow: () => void;
}, "syncMedicationData" | "addMedication" | "updateMedication" | "deleteMedication" | "addReminder" | "updateReminder" | "deleteReminder" | "updateReminderStatus" | "seedMvpRecord" | "completeInquiry" | "generateRisk" | "generateDoctorSummary" | "resetFlow">>;
export {};
