import test from 'node:test';
import assert from 'node:assert/strict';
import { planReminders, planNotifications } from '../src/reminders.mjs';
const now = new Date(2026, 10, 4, 12);
const reminder = { id: 1, petId: 'pet-a', name: 'Прогулка', date: '2026-11-04', time: '13:00', repeat: 'once' };

test('one-off, completed, past and invalid reminders', () => {
  const plan = planReminders([reminder, { ...reminder, completed: true }, { ...reminder, time: '11:00' },
    { ...reminder, time: '' }, { ...reminder, date: '2026-02-31' }], now);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].schedule.at.getHours(), 13);
  assert.equal(plan[0].extra.petId, 'pet-a');
});
test('daily preserves local clock and skips completed occurrence', () => {
  const plan = planReminders([{ ...reminder, repeat: 'daily', date: '2020-01-01', completedForDate: '2026-11-04' }], now, 3);
  assert.equal(plan[0].schedule.at.getDate(), 5);
  assert.ok(plan.every(n => n.schedule.at.getHours() === 13));
});
test('weekly keeps weekday across a year and honours future start', () => {
  const plan = planReminders([{ ...reminder, repeat: 'weekly', date: '2027-01-12' }], now, 3);
  assert.equal(plan.length, 3);
  assert.ok(plan.every(n => n.schedule.at.getDay() === 2));
  assert.equal(plan[0].schedule.at.getFullYear(), 2027);
});
test('all pets share the nearest sixty slots, with unique ids', () => {
  const plan = planReminders([{ ...reminder, repeat: 'daily', time: '14:00' },
    { ...reminder, id: 2, petId: 'pet-b', repeat: 'daily' }], now);
  assert.equal(plan.length, 60);
  assert.equal(new Set(plan.map(n => n.id)).size, 60);
  assert.equal(plan[0].extra.petId, 'pet-b');
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i].schedule.at >= plan[i - 1].schedule.at);
});
test('empty account removes all pending work', () => assert.deepEqual(planReminders([], now), []));
test('medication courses stop at their end date and suppress taken or skipped doses',()=>{
 const plan=planReminders([{...reminder,repeat:'daily',date:'2026-11-04',endDate:'2026-11-06',completedDates:['2026-11-04','2026-11-05']}],now);
 assert.equal(plan.length,1);assert.equal(plan[0].schedule.at.getDate(),6);
 assert.deepEqual(planReminders([{...reminder,repeat:'daily',endDate:'2026-11-03'}],now),[]);
});
test('daily tasks share queue, each occurrence has its own advance time, completed steps and disabled tasks are skipped',()=>{
 const pet={id:'pet-a',name:'Барни',dailyRoutinePush:{enabled:true,minutes:10},dailyRoutine:[{id:'walk',name:'Прогулка',checks:3,time:'13:00',times:['13:00','16:00','20:00']}]};
 const state={pets:[pet],reminders:[reminder],completedTasks:[{id:'walk::check:2',date:'2026-11-04',petId:'pet-a'}]};
 const plan=planNotifications(state,now,6),today=plan.filter(n=>n.schedule.at.getDate()===4);
 assert.deepEqual(today.map(n=>[n.schedule.at.getHours(),n.schedule.at.getMinutes()]),[[12,50],[13,0],[19,50]]);
 assert.equal(today[0].extra.page,'home');assert.equal(today[1].extra.reminderId,'1');
 assert.equal(planNotifications({...state,pets:[{...pet,dailyRoutinePush:{enabled:false}}]},now).length,1);
 assert.equal(planNotifications({...state,pets:[{...pet,dailyRoutine:[{...pet.dailyRoutine[0],pushEnabled:false}]}]},now).length,1);
 assert.equal(new Set(plan.map(n=>n.id)).size,plan.length);
});
test('daily advance alerts cross midnight and never revive past trigger times',()=>{
 const state={pets:[{id:'p',dailyRoutinePush:{enabled:true,minutes:10},dailyRoutine:[{id:'t',name:'Забота',time:'00:05'}]}]};
 const plan=planNotifications(state,new Date(2026,10,4,23,50),2);
 assert.equal(plan[0].schedule.at.getDate(),4);assert.equal(plan[0].schedule.at.getHours(),23);assert.equal(plan[0].schedule.at.getMinutes(),55);
 const after=planNotifications(state,new Date(2026,10,4,23,56),2);assert.equal(after[0].schedule.at.getDate(),5);
});
