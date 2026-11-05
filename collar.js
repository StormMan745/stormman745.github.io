/* Public view reads only the owner-confirmed card; no local account/session access. */
(() => {
    const content=document.getElementById('collarContent'),status=document.getElementById('collarStatus'),retry=document.getElementById('collarRetry');
    const token=location.hash.slice(1);let timer,busy=false,notBefore=0,deadline;
    const E=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
    function clear(){content.replaceChildren();clearTimeout(deadline);}
    async function load(){
        if(busy||document.hidden||Date.now()<notBefore)return;busy=true;retry.hidden=true;clearTimeout(timer);
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
        try{
            if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Карточка недоступна. Проверьте QR-код.');
            const response=await fetch('https://qexiyikdmdbdxgusqnee.supabase.co/functions/v1/petcare-platform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'collar-view',token}),cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
            if(response.status===429){notBefore=Date.now()+Math.max(1,Math.min(86400,Number(response.headers.get('Retry-After'))||60))*1000;throw new Error('Карточку открывали слишком часто. Попробуйте позже.');}
            if(!response.ok)throw new Error(response.status===404?'Владелец отключил карточку или ссылка недействительна.':'Не удалось открыть карточку. Повторите попытку.');
            const {card}=await response.json();clear();if(!card?.name)throw new Error('Карточка недоступна.');
            if(typeof card.photo==='string'&&/^data:image\/jpeg;base64,/.test(card.photo)&&card.photo.length<=28000){const img=E('img');img.src=card.photo;img.className='photo';img.alt='Фото питомца';content.append(img);}
            content.append(E('h1',card.name),E('p','Спасибо, что помогаете мне вернуться домой!'));
            let href='',label='';const contact=String(card.contact||'');
            if(card.kind==='phone'&&/^\+?[0-9() -]{7,25}$/.test(contact)){href='tel:'+contact.replace(/[^+0-9]/g,'');label='Позвонить владельцу';}
            if(card.kind==='email'&&/^[^\s<>"\r\n]+@[^\s<>"\r\n]+\.[^\s<>"\r\n]+$/.test(contact)){href='mailto:'+encodeURIComponent(contact);label='Написать владельцу';}
            if(card.kind==='telegram'&&/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(contact)){href='https://t.me/'+contact.replace(/^@/,'');label='Открыть Telegram';}
            if(href){const a=E('a',label);a.href=href;a.className='contact';a.rel='noopener noreferrer';content.append(a);const p=E('p',contact);p.className='contact-label';content.append(p);}status.textContent='';
            deadline=setTimeout(()=>{clear();status.textContent='Обновляю доступ к карточке…';},60000);
            timer=setTimeout(load,45000);
        }catch(error){clear();status.textContent=error.name==='AbortError'||error instanceof TypeError?'Для просмотра нужен интернет. Подключитесь и повторите.':error.message;retry.hidden=false;retry.disabled=Date.now()<notBefore;if(notBefore>Date.now())timer=setTimeout(()=>{retry.disabled=false;load()},notBefore-Date.now());}
        finally{busy=false;clearTimeout(timeout);}
    }
    retry.onclick=load;document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);clear();}else load();});window.addEventListener('pagehide',clear);window.addEventListener('pageshow',load);window.addEventListener('online',load);load();
})();
