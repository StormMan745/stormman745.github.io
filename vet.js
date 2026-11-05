(() => {
    const token=location.hash.slice(1),status=document.getElementById('vetStatus'),content=document.getElementById('vetContent');
    const endpoint='https://qexiyikdmdbdxgusqnee.supabase.co/functions/v1/petcare-platform';
    const key='sb_publishable_HSR87zEuGFNjwEYoa-zrSw_cTWchorw';
    const nodes=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element};
    let expiry=0,urls=[],rendered=false,inFlight=false,retryAt=0,expiryTimer;
    const requests=new Set();
    const clear=()=>{rendered=false;clearTimeout(expiryTimer);content.replaceChildren();urls.forEach(url=>URL.revokeObjectURL(url));urls=[]};
    const expired=()=>{clear();status.textContent='Срок доступа истёк.';status.dataset.error='true';};
    const armExpiry=()=>{clearTimeout(expiryTimer);expiryTimer=setTimeout(expired,Math.max(0,expiry-Date.now()));};
    const errorText=error=>error.message==='limited'?'Слишком много запросов. Подождите немного и повторите.':'Нет связи с сервером. Восстановите интернет и обновите страницу.';
    async function call(action,extra={}){
        if(Date.now()<retryAt)throw new Error('limited');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);requests.add(controller);
        try{
            const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({action,token,...extra}),cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
            if(response.status===429){retryAt=Date.now()+Math.min(86400,Math.max(1,Number(response.headers.get('Retry-After'))||60))*1000;throw new Error('limited');}
            if(!response.ok)throw new Error(response.status===404?'unavailable':'network');return response;
        }finally{clearTimeout(timer);requests.delete(controller);}
    }
    async function refresh(first=false){
        if(inFlight)return;
        if(expiry&&Date.now()>=expiry){expired();return;}
        if(!/^[A-Za-z0-9_-]{43}$/.test(token)){status.textContent='Ссылка неполная. Попросите владельца передать её целиком.';return;}
        inFlight=true;
        try{const result=await (await call('share-view')).json();expiry=Date.parse(result.expiresAt);if(!Number.isFinite(expiry)||expiry<=Date.now()){expired();return;}status.dataset.error='false';status.textContent='Доступ до '+new Date(expiry).toLocaleString('ru-RU');armExpiry();if(!first&&rendered)return;clear();armExpiry();rendered=true;
            const pet=result.data.pet;content.append(nodes('h2',pet.name||'Питомец'));
            const fields={breed:'Порода',birthDate:'Дата рождения',sex:'Пол',weight:'Вес, кг',color:'Окрас',allergies:'Аллергии',medications:'Лекарства',vetClinic:'Клиника',vetPhone:'Телефон клиники',chipNumber:'Чип'};
            const card=nodes('section','');card.className='vet-card';for(const [field,label] of Object.entries(fields))if(pet[field]!=null&&pet[field]!=='')card.append(nodes('p',`${label}: ${pet[field]}`));content.append(card);
            content.append(nodes('h2','Выбранные медицинские записи'));
            for(const record of result.data.healthRecords||[]){const item=nodes('article','');item.className='vet-card';item.append(nodes('h3',record.name||'Запись'),nodes('p',record.date||''));for(const [field,label] of Object.entries({type:'Тип',diagnosis:'Результат / диагноз',prescription:'Назначения',clinic:'Клиника',note:'Заметка'}))if(record[field])item.append(nodes('p',`${label}: ${record[field]}`));
                for(const photo of record.photos||[]){const source=typeof photo==='string'?photo:photo.dataUrl||photo.data;if(typeof source==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(source)){const image=new Image();image.src=source;image.alt='Фото к выбранной медицинской записи';item.append(image);}}content.append(item);}
            content.append(nodes('h2','Выбранные документы'));
            for(const doc of result.documents){const item=nodes('article','');item.className='vet-card';item.append(nodes('h3',doc.title),nodes('p',[doc.document_date,doc.file_name].join(' · ')));const button=nodes('button','Скачать оригинал');button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{const response=await call('share-file',{documentId:doc.id});const blob=await response.blob();if(!rendered||Date.now()>=expiry){expired();return;}const url=URL.createObjectURL(blob);urls.push(url);const link=document.createElement('a');link.href=url;link.download=doc.file_name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_');document.body.append(link);link.click();link.remove();}catch(error){status.dataset.error='true';status.textContent=error.message==='unavailable'?'Файл недоступен. Возможно, ссылка отозвана или срок доступа истёк.':errorText(error);}finally{button.disabled=false;}});item.append(button);content.append(item);}
        }catch(error){if(error.message==='unavailable'){clear();status.textContent='Ссылка отозвана, истекла или недоступна. Попросите владельца создать новую.';}else{status.textContent=errorText(error);}status.dataset.error='true';}finally{inFlight=false;}
    }
    refresh(true);setInterval(()=>{if(expiry&&Date.now()>=expiry)expired();else if(!document.hidden)refresh(false)},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(false);});
    window.addEventListener('pageshow',event=>{if(event.persisted)refresh(true);});
    window.addEventListener('pagehide',()=>{clear();requests.forEach(request=>request.abort());});
})();
