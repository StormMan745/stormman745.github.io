import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNotifications, ANDROID_REMINDER_CHANNEL } from '../src/notification-options.mjs';
import { planNotifications } from '../src/reminders.mjs';
const notification=(at='2026-11-13T10:00:00Z',id='visit')=>({id:100000,title:'Напоминание',body:'PetCare',schedule:{at:new Date(at)},extra:{petcare:true,petId:'pet',reminderId:id}});
test('Android alerts use the sound channel and stable event IDs when earlier events leave the queue',()=>{
 const later=notification('2026-11-14T10:00:00Z');
 const before=prepareNotifications([notification(),later],'owner',true),after=prepareNotifications([later],'owner',true);
 assert.notEqual(before[0].id,before[1].id,'Different days must ring as new notifications');
 assert.equal(before[1].id,after[0].id,'Removing the first occurrence must not renumber the next');
 assert(before.every(n=>n.channelId===ANDROID_REMINDER_CHANNEL&&n.id>=100060&&n.id<2147483647));
 assert.equal(before[0].extra.userId,'owner');assert.equal(before[0].body,'PetCare');
 assert.notEqual(before[0].id,prepareNotifications([notification()],'other',true)[0].id);
 assert.notEqual(before[0].id,prepareNotifications([notification('2026-11-13T10:01:00Z')],'owner',true)[0].id);
});
test('several daily steps at the same time keep separate IDs after one is completed',()=>{
 const pet={id:'pet',dailyRoutinePush:{enabled:true,minutes:10},dailyRoutine:[{id:'walk',name:'Прогулка',checks:3,time:'13:00',times:['13:00','13:00','13:00']}]};
 const now=new Date(2026,10,13,12),state={pets:[pet]};
 const before=prepareNotifications(planNotifications(state,now,3),'owner',true);
 state.completedTasks=[{id:'walk',petId:'pet',date:'2026-11-13'}];
 const after=prepareNotifications(planNotifications(state,now,3),'owner',true);
 assert.equal(new Set(before.map(n=>n.id)).size,3);assert.equal(before[1].id,after[0].id);assert.equal(before[2].id,after[1].id);
});
test('tests keep the reserved ID and channel; iOS preserves its own notification options',()=>{
 const item={...notification(),id:99999,extra:{petcare:true,test:true}};
 assert.equal(prepareNotifications([item],'owner',true)[0].id,99999);
 assert.equal(prepareNotifications([item],'owner',true)[0].channelId,ANDROID_REMINDER_CHANNEL);
 const ios=prepareNotifications([notification()],'owner',false)[0];assert.equal(ios.id,100000);assert.equal(ios.channelId,undefined);assert.equal(ios.extra.userId,'owner');
});
