import type { DeviceCapability, MobileReminder } from './types';
export declare function getDeviceCapability(): Promise<DeviceCapability>;
export declare function ensureNotificationPermission(): Promise<boolean>;
export declare function scheduleTodayReminderNotifications(reminders: MobileReminder[]): Promise<void>;
export declare function speakText(text: string): Promise<void>;
export declare function listenOnce(): Promise<string>;
