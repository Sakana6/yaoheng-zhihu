import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { NotificationQueue, type NotificationAdapter } from './notification-core';
let timers:ReturnType<typeof setTimeout>[]=[];
const shown:Notification[]=[];
const browser:NotificationAdapter={
  async clear(){timers.forEach(clearTimeout);timers=[];shown.splice(0).forEach(n=>n.close());},
  async schedule(items){for(const {occurrence:o} of items)timers.push(setTimeout(()=>{
    if(document.visibilityState==='visible'&&'Notification' in window&&Notification.permission==='granted')shown.push(new Notification(o.title,{body:'请打开药衡智护填写实际反馈',tag:o.occurrenceId}));
  },Date.parse(o.plannedAt)-Date.now()));}
};
const native:NotificationAdapter={
  async clear(){const pending=await LocalNotifications.getPending();const owned=pending.notifications.filter(n=>n.extra?.owner==='yaoheng-real');if(owned.length)await LocalNotifications.cancel({notifications:owned.map(n=>({id:n.id}))});},
  async schedule(items){if(items.length)await LocalNotifications.schedule({notifications:items.map(({id,occurrence:o})=>({id,title:o.title,body:'请打开药衡智护填写实际反馈',schedule:{at:new Date(o.plannedAt)},extra:{owner:'yaoheng-real',occurrenceId:o.occurrenceId}}))});}
};
export const notificationQueue=new NotificationQueue(Capacitor.isNativePlatform()?native:browser);
export const notificationHint=Capacitor.isNativePlatform()?'原生本地通知由系统调度；以系统权限为准。':'网页通知仅在本页保持打开且处于前台时触发；关闭网页不会继续提醒。';
export async function notificationPermission(request=false){
  if(Capacitor.isNativePlatform())return (await (request?LocalNotifications.requestPermissions():LocalNotifications.checkPermissions())).display==='granted';
  if(!('Notification' in window))return false;
  return (request?await Notification.requestPermission():Notification.permission)==='granted';
}
