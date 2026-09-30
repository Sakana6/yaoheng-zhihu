import { defineStore } from 'pinia';
export const useAppStore = defineStore('app', {
    state: () => ({
        appName: '药衡智护移动端',
        patientName: '张淑芳',
        currentStage: 'MVP',
    }),
});
