import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
function getBrowserRecognition() {
    return window
        .webkitSpeechRecognition;
}
function reminderNotificationId(reminderId) {
    return reminderId.split('').reduce((value, char) => value + char.charCodeAt(0), 0);
}
export async function getDeviceCapability() {
    const nativeShell = Capacitor.isNativePlatform();
    let canUseSpeechRecognition = typeof window !== 'undefined' && Boolean(getBrowserRecognition());
    let canUseTextToSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (nativeShell) {
        canUseTextToSpeech = true;
        try {
            const availability = await SpeechRecognition.available();
            canUseSpeechRecognition = availability.available;
        }
        catch {
            canUseSpeechRecognition = false;
        }
    }
    return {
        nativeShell,
        canScheduleNotifications: nativeShell,
        canUseSpeechRecognition,
        canUseTextToSpeech,
    };
}
export async function ensureNotificationPermission() {
    if (!Capacitor.isNativePlatform()) {
        return true;
    }
    const permissions = await LocalNotifications.checkPermissions();
    if (permissions.display === 'granted') {
        return true;
    }
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
}
export async function scheduleTodayReminderNotifications(reminders) {
    if (!Capacitor.isNativePlatform()) {
        return;
    }
    const allowed = await ensureNotificationPermission();
    if (!allowed) {
        return;
    }
    const now = Date.now();
    const notifications = reminders
        .filter((item) => item.status !== 'SUCCESS')
        .map((item) => ({
        id: reminderNotificationId(item.reminderId),
        title: '用药提醒',
        body: item.voicePrompt || item.title,
        schedule: { at: new Date(item.plannedAt) },
        extra: { reminderId: item.reminderId },
    }))
        .filter((item) => item.schedule.at.getTime() > now);
    if (notifications.length === 0) {
        return;
    }
    await LocalNotifications.schedule({ notifications });
}
export async function speakText(text) {
    if (!text.trim()) {
        return;
    }
    if (Capacitor.isNativePlatform()) {
        await TextToSpeech.speak({
            text,
            lang: 'zh-CN',
            rate: 0.96,
            pitch: 1,
            volume: 1,
        });
        return;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 0.96;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }
}
export async function listenOnce() {
    if (Capacitor.isNativePlatform()) {
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== 'granted') {
            throw new Error('Speech recognition permission denied');
        }
        const result = await SpeechRecognition.start({
            language: 'zh-CN',
            maxResults: 1,
            partialResults: false,
            popup: true,
            prompt: '请回答',
        });
        const transcript = result.matches?.[0]?.trim();
        if (!transcript) {
            throw new Error('No speech recognized');
        }
        return transcript;
    }
    const BrowserRecognition = typeof window !== 'undefined' ? getBrowserRecognition() : undefined;
    if (!BrowserRecognition) {
        throw new Error('Speech recognition is not available');
    }
    return new Promise((resolve, reject) => {
        const recognition = new BrowserRecognition();
        let settled = false;
        recognition.lang = 'zh-CN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event) => {
            const transcript = event.results?.[0]?.[0]?.transcript?.trim();
            settled = true;
            if (!transcript) {
                reject(new Error('No speech recognized'));
                return;
            }
            resolve(transcript);
        };
        recognition.onerror = (event) => {
            settled = true;
            reject(new Error(event.error ?? 'Speech recognition failed'));
        };
        recognition.onend = () => {
            if (!settled) {
                reject(new Error('Speech recognition ended without result'));
            }
        };
        recognition.start();
    });
}
