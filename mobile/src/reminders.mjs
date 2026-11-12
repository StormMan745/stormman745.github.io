const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// iOS has a limited pending-notification queue. Reserve four slots for the OS/other uses.
// Expand recurring reminders by calendar days to preserve local time across DST.
export function planReminders(reminders, now = new Date(), limit = 60) {
  const upcoming = [];
  for (const reminder of reminders) {
    if (reminder.completed && (!reminder.repeat || reminder.repeat === 'once')) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reminder.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time || '')) continue;
    const [year, month, day] = reminder.date.split('-').map(Number);
    const [hour, minute] = reminder.time.split(':').map(Number);
    const start = new Date(year, month - 1, day, hour, minute);
    if (dateKey(start) !== reminder.date) continue;
    const step = reminder.repeat === 'daily' ? 1 : reminder.repeat === 'weekly' ? 7 : 0;
    const next = new Date(start);
    if (step && next <= now) {
      const elapsed = Math.max(0, Math.floor((now - next) / 86400000));
      next.setDate(next.getDate() + Math.max(0, Math.floor(elapsed / step) - 1) * step);
      while (next <= now) next.setDate(next.getDate() + step);
    }
    for (let i = 0; i < (step ? limit : 1); i++) {
      if(reminder.endDate && dateKey(next)>reminder.endDate)break;
      if (next > now && reminder.completedForDate !== dateKey(next) && !(Array.isArray(reminder.completedDates)&&reminder.completedDates.includes(dateKey(next)))) upcoming.push({
        title: 'Напоминание PetCare', body: String(reminder.name || 'Забота о питомце').slice(0, 200),
        schedule: { at: new Date(next), allowWhileIdle: true },
        extra: { petcare: true, reminderId: String(reminder.id), petId: String(reminder.petId || '') }
      });
      if (!step) break;
      next.setDate(next.getDate() + step);
    }
  }
  return upcoming.sort((a, b) => a.schedule.at - b.schedule.at).slice(0, limit)
    .map((item, index) => ({ ...item, id: 100000 + index }));
}

export function planNotifications(state, now = new Date(), limit = 60) {
  const upcoming = planReminders(state.reminders || [], now, limit);
  const completed = new Set((Array.isArray(state.completedTasks) ? state.completedTasks : []).filter(Boolean).map(row => JSON.stringify([String(row.petId), row.date, row.id])));
  for (const pet of Array.isArray(state.pets) ? state.pets : []) {
    if (!pet || pet.isPlaceholder || !(pet.dbId || pet.id) || pet.dailyRoutinePush?.enabled !== true) continue;
    const petId = String(pet.dbId ?? pet.id), minutes = [5,10,15,30].includes(pet.dailyRoutinePush.minutes) ? pet.dailyRoutinePush.minutes : 10;
    const seen = new Set();
    for (const task of (Array.isArray(pet.dailyRoutine) ? pet.dailyRoutine : []).slice(0,20)) {
      if (typeof task?.id !== 'string' || !task.id || !String(task.name || '').trim() || seen.has(task.id) || task.pushEnabled === false) continue;
      seen.add(task.id);
      const checks = Number.isInteger(Number(task.checks)) ? Math.max(1,Math.min(12,Number(task.checks))) : 1;
      for (let step=1;step<=checks;step++) {
        const time = step===1 && task.time ? task.time : task.times?.[step-1] || task.time;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) continue;
        const [hour,minute] = time.split(':').map(Number), id = step===1 ? task.id : `${task.id}::check:${step}`;
        for (let day=0;day<=limit;day++) {
          const due = new Date(now.getFullYear(),now.getMonth(),now.getDate()+day,hour,minute);
          if (due.getHours()!==hour || due.getMinutes()!==minute) continue;
          const at = new Date(due.getTime()-minutes*60000);
          if (at<=now || completed.has(JSON.stringify([petId,dateKey(due),id]))) continue;
          upcoming.push({title:`${String(pet.name || 'PetCare').slice(0,60)}: напоминание`,body:`Скоро: ${String(task.name || 'Ежедневное дело').slice(0,80)}${checks>1?` · ${step} из ${checks}`:''} · ${time}`,
            schedule:{at,allowWhileIdle:true},extra:{petcare:true,routineId:task.id,petId,page:'home'}});
        }
      }
    }
  }
  return upcoming.sort((a,b)=>a.schedule.at-b.schedule.at).slice(0,limit).map((item,index)=>({...item,id:100000+index}));
}
