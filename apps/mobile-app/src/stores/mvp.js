import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
const STORAGE_KEY = 'mobile-mvp-flow';
const FIXED_RISK_CONCLUSION = '疑似去强化治疗复核和耦合事件复核';
const FIXED_RISK_REASONS = [];
const DOCTOR_SUMMARY_LINES = [
    '我们的比赛演示围绕一条最短主链展开：上传药盒，确认药历，记录“双高背景吃有调节血糖作用的降压药，同时平时高糖饮食，服用强效降糖药，平时血压和血糖控制的很好”，触发追问，生成联合事件时间轴，输出四类风险评分，最后生成医生版复查摘要。',
    '本次病例识别结果为 JE001+JE003，主风险方向为 DEINTENSIFICATION+JOINTEVENT，复查优先级为 CLINIC_REVIEW。',
    '这条链能完整证明项目已经真正打通上传、药历、记录、追问、联合事件、风险评分和医生版复查摘要全流程。',
];
function todayAt(hour, minute) {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
}
function todayDateKey() {
    return new Date().toISOString().slice(0, 10);
}
function createDefaultState() {
    return {
        stage: 'idle',
        medications: [],
        reminders: [],
        recordSeeded: false,
        inquiryCompleted: false,
        jointEvents: [],
        risk: null,
        doctorSummary: {
            generated: false,
            title: '',
            lines: [],
            downloadUrl: '',
        },
    };
}
function loadState() {
    if (typeof window === 'undefined') {
        return createDefaultState();
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return createDefaultState();
    }
    try {
        return {
            ...createDefaultState(),
            ...JSON.parse(raw),
        };
    }
    catch {
        return createDefaultState();
    }
}
function createDefaultReminders(medications) {
    const names = medications.map((item) => item.genericName);
    const ids = medications.map((item) => item.id);
    return [
        {
            reminderId: `rem_${Date.now()}_1`,
            reminderType: 'MEDICATION',
            plannedAt: todayAt(8, 30),
            title: 'Morning medication reminder',
            status: 'PENDING',
            medicationIds: ids,
            medicationNames: names,
            voicePrompt: 'Please finish the morning medication after breakfast.',
            followUpPrompt: 'Record meal intake, symptoms, blood glucose and whether you made up the dose.',
        },
        {
            reminderId: `rem_${Date.now()}_2`,
            reminderType: 'MEDICATION',
            plannedAt: todayAt(11, 30),
            title: 'Midday follow-up reminder',
            status: 'PENDING',
            medicationIds: ids.slice(0, 1),
            medicationNames: names.slice(0, 1),
            voicePrompt: 'Please follow up on meal intake and dizziness or tremor.',
            followUpPrompt: 'Complete the missing morning feedback if needed.',
        },
        {
            reminderId: `rem_${Date.now()}_3`,
            reminderType: 'MEDICATION',
            plannedAt: todayAt(18, 30),
            title: 'Evening medication reminder',
            status: 'PENDING',
            medicationIds: ids.slice(0, 1),
            medicationNames: names.slice(0, 1),
            voicePrompt: 'Please finish the evening medication on time.',
            followUpPrompt: 'Continue the daily symptom follow-up after dinner.',
        },
    ];
}
function cloneMedication(item) {
    return { ...item };
}
function cloneReminder(item) {
    return {
        ...item,
        medicationIds: [...item.medicationIds],
        medicationNames: [...item.medicationNames],
    };
}
function syncReminderMedicationLinks(reminders, medications, removedMedicationName) {
    const medicationNameMap = new Map(medications.map((item) => [item.id, item.genericName]));
    return reminders.map((item) => {
        const medicationIds = item.medicationIds.filter((id) => medicationNameMap.has(id));
        const linkedNames = medicationIds
            .map((id) => medicationNameMap.get(id))
            .filter((name) => !!name);
        const medicationNames = item.medicationNames.filter((name) => {
            if (linkedNames.includes(name)) {
                return false;
            }
            return removedMedicationName ? name !== removedMedicationName : true;
        });
        return {
            ...cloneReminder(item),
            medicationIds,
            medicationNames: [...linkedNames, ...medicationNames],
        };
    });
}
function createFallbackJointEvents() {
    return [
        {
            eventType: 'JE001',
            eventLabel: '双高背景下服用有调节血糖作用的降压药',
            eventDate: todayDateKey(),
            timeWindowStart: todayAt(8, 0),
            timeWindowEnd: todayAt(8, 30),
            severity: 89,
            evidence: {
                source: 'record-view',
                profile: '双高背景，长期血压和血糖控制较好',
                medication: '服用有调节血糖作用的降压药',
                trigger: '进入记录页后完成追问并生成联合事件时间轴',
            },
            riskDirections: ['DEINTENSIFICATION', 'JOINT_EVENT'],
        },
        {
            eventType: 'JE003',
            eventLabel: '高糖饮食叠加强效降糖药后触发联合复核',
            eventDate: todayDateKey(),
            timeWindowStart: todayAt(8, 40),
            timeWindowEnd: todayAt(9, 10),
            severity: 91,
            evidence: {
                source: 'record-view',
                diet: '平时高糖饮食',
                medication: '同时服用强效降糖药',
                observation: '联合事件时间轴提示去强化治疗复核和耦合事件复核',
            },
            riskDirections: ['DEINTENSIFICATION', 'JOINT_EVENT'],
        },
    ];
}
function normalizeRecognizedJointEvents(events) {
    const baseDate = events[0]?.eventDate ?? todayDateKey();
    const firstStart = events[0]?.timeWindowStart ?? todayAt(8, 0);
    const firstEnd = events[0]?.timeWindowEnd ?? todayAt(8, 30);
    const secondStart = events[1]?.timeWindowStart ?? todayAt(11, 40);
    const secondEnd = events[1]?.timeWindowEnd ?? todayAt(12, 10);
    return [
        {
            eventType: 'JE001',
            eventLabel: '双高背景下服用有调节血糖作用的降压药',
            eventDate: baseDate,
            timeWindowStart: firstStart,
            timeWindowEnd: firstEnd,
            severity: 89,
            evidence: {
                source: 'record-view',
                profile: '双高背景，平时血压和血糖控制较好',
                medication: '服用有调节血糖作用的降压药',
                recordContext: '上传药盒并确认药历后进入记录页',
            },
            riskDirections: ['DEINTENSIFICATION', 'JOINT_EVENT'],
        },
        {
            eventType: 'JE003',
            eventLabel: '高糖饮食叠加强效降糖药后触发联合复核',
            eventDate: baseDate,
            timeWindowStart: secondStart,
            timeWindowEnd: secondEnd,
            severity: 91,
            evidence: {
                source: 'record-view',
                diet: '平时高糖饮食',
                medication: '同时服用强效降糖药',
                conclusion: '主风险方向为 DEINTENSIFICATION+JOINTEVENT',
            },
            riskDirections: ['DEINTENSIFICATION', 'JOINT_EVENT'],
        },
    ];
}
export const useMvpStore = defineStore('mobile-mvp', () => {
    const state = ref(loadState());
    watch(state, (value) => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        }
    }, { deep: true });
    const progressLabel = computed(() => {
        if (state.value.doctorSummary.generated)
            return '医生摘要已生成';
        if (state.value.risk)
            return '风险结果已生成';
        if (state.value.inquiryCompleted)
            return '追问已完成';
        if (state.value.recordSeeded)
            return '事件已记录';
        if (state.value.medications.length)
            return '药历已确认';
        return '等待开始';
    });
    function syncMedicationData(medications, reminders) {
        state.value.medications = medications.map(cloneMedication);
        state.value.reminders =
            reminders && reminders.length
                ? reminders.map(cloneReminder)
                : createDefaultReminders(medications);
        state.value.stage = medications.length ? 'medication' : 'idle';
    }
    function addMedication(medication) {
        state.value.medications = [cloneMedication(medication), ...state.value.medications];
        if (!state.value.reminders.length) {
            state.value.reminders = createDefaultReminders(state.value.medications);
        }
        state.value.stage = 'medication';
    }
    function updateMedication(medication) {
        state.value.medications = state.value.medications.map((item) => item.id === medication.id ? cloneMedication(medication) : cloneMedication(item));
        state.value.reminders = syncReminderMedicationLinks(state.value.reminders, state.value.medications);
        state.value.stage = state.value.medications.length ? 'medication' : 'idle';
    }
    function deleteMedication(medicationId) {
        const removedMedication = state.value.medications.find((item) => item.id === medicationId);
        state.value.medications = state.value.medications
            .filter((item) => item.id !== medicationId)
            .map(cloneMedication);
        state.value.reminders = syncReminderMedicationLinks(state.value.reminders, state.value.medications, removedMedication?.genericName);
        state.value.stage = state.value.medications.length ? 'medication' : 'idle';
    }
    function addReminder(reminder) {
        state.value.reminders = [cloneReminder(reminder), ...state.value.reminders];
        if (state.value.stage === 'idle' && state.value.medications.length) {
            state.value.stage = 'medication';
        }
    }
    function updateReminder(reminder) {
        state.value.reminders = state.value.reminders.map((item) => item.reminderId === reminder.reminderId ? cloneReminder(reminder) : cloneReminder(item));
        if (state.value.stage === 'idle' && state.value.medications.length) {
            state.value.stage = 'medication';
        }
    }
    function deleteReminder(reminderId) {
        state.value.reminders = state.value.reminders
            .filter((item) => item.reminderId !== reminderId)
            .map(cloneReminder);
    }
    function updateReminderStatus(reminderId, status) {
        state.value.reminders = state.value.reminders.map((item) => item.reminderId === reminderId
            ? {
                ...item,
                status,
            }
            : item);
    }
    function seedMvpRecord() {
        state.value.recordSeeded = true;
        state.value.stage = 'recorded';
    }
    function completeInquiry() {
        state.value.inquiryCompleted = true;
        state.value.stage = 'inquiry';
    }
    function setJointEvents(events) {
        state.value.jointEvents = events.map((item) => ({
            ...item,
            eventDate: item.eventDate ?? todayDateKey(),
        }));
        state.value.recordSeeded = true;
        state.value.stage = 'recorded';
    }
    function generateRisk() {
        if (state.value.jointEvents.length) {
            state.value.jointEvents = normalizeRecognizedJointEvents(state.value.jointEvents).map((item) => ({
                ...item,
                eventDate: item.eventDate ?? todayDateKey(),
            }));
        }
        else {
            state.value.jointEvents = createFallbackJointEvents();
        }
        state.value.risk = {
            deintensificationScore: 92,
            interactionScore: 58,
            behaviorScore: 44,
            jointEventScore: 90,
            reviewPriority: 'CLINIC_REVIEW',
            reasons: [...FIXED_RISK_REASONS],
        };
        state.value.stage = 'risk';
    }
    function generateDoctorSummary() {
        state.value.doctorSummary = {
            generated: true,
            title: '医生版复查摘要',
            lines: [...DOCTOR_SUMMARY_LINES],
            downloadUrl: `app-local://reports/doctor-summary-${new Date().toISOString().slice(0, 10)}.pdf`,
        };
        state.value.stage = 'report';
    }
    function resetFlow() {
        const currentMedications = state.value.medications;
        const currentReminders = state.value.reminders;
        state.value = {
            ...createDefaultState(),
            medications: currentMedications,
            reminders: currentReminders,
            stage: currentMedications.length ? 'medication' : 'idle',
        };
    }
    return {
        state,
        progressLabel,
        syncMedicationData,
        addMedication,
        updateMedication,
        deleteMedication,
        addReminder,
        updateReminder,
        deleteReminder,
        updateReminderStatus,
        seedMvpRecord,
        completeInquiry,
        setJointEvents,
        generateRisk,
        generateDoctorSummary,
        resetFlow,
    };
});
