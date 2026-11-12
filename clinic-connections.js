// Owner-authorized, per-pet incoming connections; raw write tokens live only in this dialog.
(() => {
 const $=id=>document.getElementById(id),make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 let epoch=0,secret=null,busy=false,sequence=0,refreshTimer,opened=null;
 const dialog=make('dialog',undefined,'clinic-connection-dialog');dialog.id='clinicConnectionDialog';
 dialog.innerHTML='<form method="dialog"><button class="secondary-button clinic-connection-close" aria-label="Закрыть подключения">Закрыть</button></form><p class="page-eyebrow">ДАННЫЕ ОТ КЛИНИК</p><h2>Записи без переписывания</h2><p id="clinicConnectionPet"></p><p>После настройки со стороны клиники приёмы и текстовые результаты обследований будут появляться в разделе здоровья. Для каждой клиники создаётся отдельное разрешение на одного питомца.</p><form id="clinicConnectionForm"><label for="clinicConnectionName">Название клиники</label><input id="clinicConnectionName" maxlength="120" required placeholder="Например, клиника вашего ветеринара"><label class="clinic-connection-consent"><input id="clinicConnectionConsent" type="checkbox" required><span>Разрешаю выбранной клинике добавлять медицинские записи этого питомца в мой аккаунт. Разрешение можно отозвать.</span></label><button id="clinicConnectionCreate" type="submit" class="primary-button">Создать подключение</button></form><p id="clinicConnectionStatus" role="status" aria-live="polite"></p><section id="clinicConnectionSecret" hidden><h3>Передайте настройку клинике</h3><p>Этот ключ позволяет только добавлять записи выбранного питомца. Передайте его администратору или специалисту клиники. Ключ показывается один раз; до настройки клиникой передача не начнётся.</p><label for="clinicConnectionKey">Ключ передачи</label><input id="clinicConnectionKey" type="password" readonly autocomplete="off"><div class="care-actions"><button id="clinicConnectionCopy" type="button" class="secondary-button">Скопировать ключ</button><button id="clinicConnectionDownload" type="button" class="secondary-button">Скачать инструкцию для клиники</button></div></section><div class="clinic-connection-heading"><h3>Разрешения для питомца</h3><button id="clinicConnectionRefresh" type="button" class="secondary-button">Обновить</button></div><div id="clinicConnectionList"></div><details class="clinic-government"><summary>Госуслуги, mos.ru и документы</summary><p>Автоматическая передача из государственных личных кабинетов пока не подключена. Если портал позволяет скачать выписку, сохраните её и загрузите в PetCare. PDF и фотографии документов можно прикреплять в разделе здоровья.</p><div class="care-actions"><a class="secondary-button" href="https://www.gosuslugi.ru/" target="_blank" rel="noopener noreferrer">Госуслуги ↗</a><a class="secondary-button" href="https://www.mos.ru/pgu/ru/app/dvm/mypets/" target="_blank" rel="noopener noreferrer">Мой питомец на mos.ru ↗</a><button id="clinicConnectionDocuments" type="button" class="secondary-button">Загрузить документ</button></div><p>Подключение к API зависит от клиники и её системы учёта. Поддержка приёма данных в PetCare не означает, что конкретная клиника уже подключена.</p></details>';
 document.body.append(dialog);
 const openButton=make('button','⇄ Данные из клиник','care-button');openButton.type='button';openButton.id='clinicConnectionsButton';$('healthPage').querySelector('.health-passport').append(openButton);
 const context=()=>({uid:activeUserId,pet:getActivePetKey(),epoch}),same=c=>c.uid===activeUserId&&c.pet===getActivePetKey()&&c.epoch===epoch;
 const message=text=>$('clinicConnectionStatus').textContent=text;
 function clearSecret(){secret=null;$('clinicConnectionKey').value='';$('clinicConnectionSecret').hidden=true;}
 function setBusy(value){busy=value;for(const id of ['clinicConnectionCreate','clinicConnectionName','clinicConnectionConsent'])$(id).disabled=value;}
 const labels={authentication_required:'Войдите в аккаунт снова.',connection_limit:'Слишком много активных подключений. Отзовите неиспользуемые разрешения.',pet_not_found:'Сначала сохраните питомца в аккаунте и синхронизируйте данные.',rate_limited:'Подождите немного и повторите попытку.'};
 function errorText(error){return labels[error.message]||'Не удалось связаться с сервером. Проверьте интернет и повторите попытку.';}
 function date(value){return new Date(value).toLocaleString('ru-RU');}
 async function load(){
  if(!dialog.open||!activeUserId)return;const c=context(),request=++sequence;
  try{
   const rows=await PetCareFiles.platform('clinic-list',{petId:c.pet});if(!same(c)||request!==sequence||!dialog.open)return;
   const list=$('clinicConnectionList');list.replaceChildren();
   if(!rows.length)list.append(make('p','Подключений пока нет. Создайте разрешение и передайте инструкцию выбранной клинике.','empty-state'));
   for(const row of rows){const card=make('article',undefined,'clinic-connection-card');card.append(make('strong',row.clinic_name));
    const inactive=row.revoked_at||Date.parse(row.expires_at)<=Date.now();
    card.append(make('p',row.revoked_at?'Разрешение отозвано':inactive?'Срок разрешения истёк':row.received_count?`Получено записей: ${row.received_count} · ${date(row.last_received_at)}`:'Ожидает настройки клиникой и первой передачи'));
    if(!inactive){card.append(make('small',`Разрешение действует до ${date(row.expires_at)}`));const revoke=make('button','Отозвать разрешение','secondary-button');revoke.type='button';
     revoke.addEventListener('click',async()=>{if(!same(c)||!confirm('Отозвать разрешение? Новые записи от этой клиники больше не будут приниматься. Уже полученные записи сохранятся.'))return;revoke.disabled=true;
      try{await PetCareFiles.platform('clinic-revoke',{id:row.id});if(!same(c))return;if(secret?.id===row.id)clearSecret();message('Разрешение отозвано.');await load();}
      catch(error){if(same(c)){message(errorText(error));revoke.disabled=false;}}});card.append(revoke);}
    list.append(card);
   }
  }catch(error){if(same(c)&&request===sequence)message(errorText(error));}
 }
 async function open(){
  if(!activeUserId||appData.pet?.isPlaceholder){alert('Сначала добавьте и сохраните питомца.');return;}
  epoch++;opened=context();clearSecret();setBusy(false);$('clinicConnectionForm').reset();message('');$('clinicConnectionList').replaceChildren(make('p','Проверяю подключения…','empty-state'));$('clinicConnectionPet').textContent=`Питомец: ${appData.pet.name||'ваш питомец'}`;dialog.showModal();
  if(!navigator.onLine){message('Для подключения клиники нужен интернет. Сохранённые медицинские записи доступны в разделе здоровья.');return;}
  await load();
 }
 $('clinicConnectionForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!activeUserId)return;
  if(!navigator.onLine){message('Для создания разрешения нужен интернет.');return;}
  const c=context(),name=$('clinicConnectionName').value.trim();if(!name||!$('clinicConnectionConsent').checked)return;setBusy(true);clearSecret();
  try{
   const synced=await PetCareSync.flush();if(!same(c))return;if(!synced){message('Сначала дождитесь сохранения данных аккаунта. Затем повторите подключение.');return;}
   const data=await PetCareFiles.platform('clinic-create',{petId:c.pet,clinicName:name,consent:true});if(!same(c)||!dialog.open)return;
   secret={...data,clinicName:name,petName:appData.pet.name};$('clinicConnectionKey').value=data.token;$('clinicConnectionSecret').hidden=false;message('Разрешение создано. Для начала передачи клиника должна настроить интеграцию.');await load();
  }catch(error){if(same(c))message(errorText(error));}finally{if(same(c))setBusy(false);}
 });
 $('clinicConnectionCopy').addEventListener('click',async()=>{if(!secret)return;const c=context(),value=secret.token;try{await navigator.clipboard.writeText(value);if(same(c))message('Ключ скопирован. Передайте его только выбранной клинике.');}catch{if(same(c))message('Копирование недоступно. Скачайте инструкцию для клиники.');}});
 $('clinicConnectionDownload').addEventListener('click',async()=>{
  if(!secret)return;const c=context();const setup={format:'petcare-clinic-v1',clinicName:secret.clinicName,petName:secret.petName,
   endpoint:secret.endpoint,authorization:`Bearer ${secret.token}`,method:'POST',contentType:'application/json',
   instructions:'Настройку выполняет клиника после проверки владельца и питомца. Отправляйте данные только этого питомца. Ключ не даёт доступа к чтению аккаунта. Для исправления записи отправьте новый eventId. PDF и фотографии загружаются владельцем отдельно.',
   example:{eventId:'your-unique-visit-id',record:{kind:'visit',date:getLocalDateInputValue(),name:'Приём ветеринара',doctor:'ФИО врача',note:'Заключение',diagnosis:'Диагноз из медкарты',prescription:'Назначения врача'}},
   examinationExample:{eventId:'your-unique-examination-id',record:{kind:'examination',date:getLocalDateInputValue(),name:'Результат обследования',labName:secret.clinicName,results:'Текст результатов'}}};
  const blob=new Blob([JSON.stringify(setup,null,2)],{type:'application/json'});
  if(window.PetCareNative){try{await PetCareNative.shareFile(blob,'PetCare-clinic-setup.json');}catch{if(same(c))message('Не удалось сохранить инструкцию. Повторите попытку.');}return;}
  const url=URL.createObjectURL(blob),link=make('a');link.href=url;link.download='PetCare-clinic-setup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 $('clinicConnectionDocuments').addEventListener('click',()=>{dialog.close();PetCareDocuments.open();});
 $('clinicConnectionRefresh').addEventListener('click',load);openButton.addEventListener('click',open);
 dialog.addEventListener('close',()=>{epoch++;sequence++;opened=null;clearSecret();setBusy(false);});
 window.addEventListener('petcare:account-reset',()=>{epoch++;sequence++;clearTimeout(refreshTimer);clearSecret();dialog.close();$('clinicConnectionList').replaceChildren();message('');});
 window.addEventListener('petcare:data-changed',()=>{if(!dialog.open)return;if(!opened||!same(opened)||$('clinicConnectionPet').textContent!==`Питомец: ${appData.pet.name||'ваш питомец'}`){dialog.close();return;}clearTimeout(refreshTimer);refreshTimer=setTimeout(load,500);});
 window.PetCareClinicConnections={open};
})();
