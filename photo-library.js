// Private, per-pet albums use the existing story snapshot and offline file queue.
(() => {
    const $ = id => document.getElementById(id), bucket = 'petcare-stories';
    const selected = new Set();
    let context = '', epoch = 0, operation = null, limit = 24, viewUrl = null;
    const modal = document.createElement('dialog');
    modal.id = 'memoryPhotoDialog'; modal.className = 'memory-photo-dialog';
    modal.innerHTML = '<form method="dialog"><button class="secondary-button" aria-label="Закрыть фотографию">Закрыть</button></form><h3 id="memoryPhotoTitle"></h3><img id="memoryPhotoPreview" alt=""><label for="memoryPhotoDate">Дата фото</label><input id="memoryPhotoDate" type="date"><div class="care-actions"><button id="memoryPhotoSaveDate" type="button" class="secondary-button">Сохранить дату</button><button id="memoryPhotoDownload" type="button" class="secondary-button">Скачать фото</button><button id="memoryPhotoDelete" type="button" class="secondary-button">Удалить из библиотеки</button></div><p id="memoryPhotoStatus" role="status"></p>';
    document.body.append(modal);
    modal.querySelector('label[for="memoryPhotoDate"]').textContent = 'Дата фото (необязательно)';
    const albums = () => (appData.storyProjects || []).filter(row => row.kind === 'photo-library' && String(row.petId) === getActivePetKey());
    const photos = () => albums().flatMap(album => (album.photos || []).map(photo => ({ ...photo, albumId: album.id })));
    const find = id => photos().find(photo => photo.id === id);
    const dateLabel = date => date ? formatHistoryDate(date) : 'Без даты';
    const ready = () => activeUserId && appData.pet && !appData.pet.isPlaceholder;
    const token = () => ({ user: activeUserId, pet: getActivePetKey(), epoch });
    const current = ctx => ctx && ctx.user === activeUserId && ctx.pet === getActivePetKey() && ctx.epoch === epoch;
    const ownedPath = (path, user) => typeof path === 'string' && path.startsWith(user + '/') && !path.split('/').some(part => part === '.' || part === '..') && !/[\\\u0000-\u001f]/.test(path);
    function message(text) { $('memoryLibraryStatus').textContent = text; }
    function releasePreview() { if (viewUrl) URL.revokeObjectURL(viewUrl); viewUrl = null; $('memoryPhotoPreview').removeAttribute('src'); }
    function reset() { epoch++; selected.clear(); limit = 24; modal.close(); releasePreview(); context = ''; operation = null; $('memoryLibraryMonth').value = ''; }
    function controls() {
        const busy = Boolean(operation);
        $('memoryLibrary').setAttribute('aria-busy', String(busy));
        $('memoryLibraryUpload').disabled = busy || !ready();
        $('memoryLibraryMovie').disabled = busy || selected.size < 2 || selected.size > STORY_MAX_PHOTOS;
        $('memoryLibraryMovie').textContent = selected.size ? `Создать фильм · выбрано ${selected.size} из ${STORY_MAX_PHOTOS}` : 'Создать фильм из выбранных';
        $('memoryLibraryClear').disabled = busy || !selected.size;
        $('memoryLibraryGrid').querySelectorAll('input,button').forEach(el => { el.disabled = busy; });
    }
    function render() {
        const key = `${activeUserId || ''}:${getActivePetKey()}`;
        if (context !== key) { reset(); context = key; message(''); }
        $('memoryLibraryPet').textContent = ready() ? `Фотографии: ${appData.pet.name || 'вашего питомца'}` : 'Добавьте питомца, чтобы сохранять фотографии.';
        const all = photos().sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
        for (const id of selected) if (!all.some(photo => photo.id === id)) selected.delete(id);
        const filter = $('memoryLibraryMonth'), value = filter.value;
        filter.replaceChildren(new Option('Все фотографии', ''));
        if (all.some(photo => !photo.date)) filter.append(new Option('Без даты','__undated__'));
        [...new Set(all.map(photo => String(photo.date || '').slice(0,7)).filter(month => /^\d{4}-\d{2}$/.test(month)))].sort().reverse().forEach(month => filter.append(new Option(formatStoryMonth(month),month)));
        filter.value = [...filter.options].some(option => option.value === value) ? value : '';
        const list = all.filter(photo => !filter.value || (filter.value==='__undated__' ? !photo.date : photo.date?.startsWith(filter.value)));
        const grid = $('memoryLibraryGrid'); grid.replaceChildren();
        if (!list.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = all.length ? 'В этом месяце фотографий нет.' : 'Здесь будут фотографии вашего питомца. Добавьте первый снимок — создавать фильм сразу не обязательно.'; grid.append(empty); }
        for (const photo of list.slice(0,limit)) {
            const card = document.createElement('article'); card.className = 'memory-library-photo';
            const open = document.createElement('button'); open.type = 'button'; open.className = 'memory-library-open'; open.setAttribute('aria-label', `Открыть фото: ${photo.name || 'Питомец'}, ${dateLabel(photo.date)}`);
            const image = document.createElement('img'); image.alt = `${appData.pet.name || 'Питомец'} · ${dateLabel(photo.date)}`; image.loading = 'lazy'; setStoryMediaSource(image, photo.path); open.append(image); open.addEventListener('click', () => openPhoto(photo.id));
            const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(photo.id); check.setAttribute('aria-label', `Выбрать фото ${photo.name || ''} для фильма`);
            check.addEventListener('change', () => { if (check.checked && selected.size >= STORY_MAX_PHOTOS) { check.checked = false; message('Для одного фильма можно выбрать до 12 фото.'); return; } check.checked ? selected.add(photo.id) : selected.delete(photo.id); controls(); });
            const date = document.createElement('span'); date.textContent = dateLabel(photo.date); label.append(check,date); card.append(open,label); grid.append(card);
        }
        $('memoryLibraryMore').hidden = list.length <= limit;
        if (modal.open && (!find(modal.dataset.photoId) || modal.dataset.context !== key)) modal.close();
        controls();
    }
    async function run(action) {
        if (!ready() || operation) return;
        const ctx = token(); const job = {}; operation = job; controls();
        try { await action(ctx); }
        catch (error) { if (current(ctx)) { const text=error.message || 'Не удалось сохранить фотографии. Повторите попытку.'; message(text); if(modal.open)$('memoryPhotoStatus').textContent=text; } }
        finally { if (operation === job) { operation = null; render(); } }
    }
    async function upload(input) {
        const files = [...input.files || []]; input.value = '';
        if (input.dataset.context !== context || Number(input.dataset.epoch) !== epoch || !files.length) return;
        await run(async ctx => {
            let added = 0; const errors = [];
            if (files.length > 20) errors.push('За один раз добавляется до 20 фото. Остальные выберите следующей загрузкой.');
            for (const file of files.slice(0,20)) {
                if (!current(ctx)) return;
                if (!file.size || file.size > 20*1024*1024 || (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name))) { errors.push(`${file.name}: выберите фото до 20 МБ.`); continue; }
                message(`Добавляю фото ${added+1} из ${Math.min(files.length,20)}…`);
                let data;
                try { data = await compressPetPhoto(file,1800,.88); } catch { errors.push(`${file.name}: фото не открылось. Попробуйте JPEG, PNG или WebP.`); continue; }
                if (!current(ctx)) return;
                let album = albums()[0];
                if (!album) album = { id: createEntryId('photo-library'), kind: 'photo-library', petId: ctx.pet, photos: [], createdAt: new Date().toISOString() };
                const id = createEntryId('photo'), path = `${ctx.user}/${album.id}/${id}.jpg`;
                await PetCareFiles.upload(bucket,path,storyPhotoDataToBlob(data),{contentType:'image/jpeg'});
                if (!current(ctx)) { if (activeUserId===ctx.user) await supabaseClient.storage.from(bucket).remove([path]); return; }
                if (!appData.storyProjects.some(row => row.id === album.id)) appData.storyProjects.push(album);
                else album = appData.storyProjects.find(row => row.id === album.id);
                const photo = { id, path, name: file.name.slice(0,160), date: file.lastModified ? getLocalDateInputValue(new Date(file.lastModified)) : getLocalDateInputValue(), takenAt: new Date().toISOString() };
                album.photos.push(photo);
                try { await saveData(); } catch (error) { album.photos = album.photos.filter(row => row.id !== id); throw error; }
                if (!current(ctx)) return;
                added++; render();
            }
            if (current(ctx)) message(`Добавлено фото: ${added}. ${errors.join(' ')}${navigator.onLine ? '' : 'Сохранено на устройстве. Отправка продолжится при появлении связи.'}`);
        });
    }
    async function openPhoto(id) {
        const photo = find(id); if (!photo || operation || !ready()) return;
        releasePreview(); const ctx = token();
        modal.dataset.photoId = id; modal.dataset.context = context;
        $('memoryPhotoTitle').textContent = photo.name || 'Фото питомца'; $('memoryPhotoDate').value = photo.date || '';
        $('memoryPhotoStatus').textContent = 'Загружаю фотографию…'; $('memoryPhotoPreview').alt = appData.pet.name || 'Фотография питомца'; modal.showModal();
        try {
            const blob = await PetCareFiles.download(bucket,photo.path,ctx.user);
            if (!current(ctx) || !modal.open || modal.dataset.photoId !== id) return;
            viewUrl = URL.createObjectURL(blob); $('memoryPhotoPreview').src = viewUrl; $('memoryPhotoStatus').textContent = '';
        } catch (error) { if (current(ctx) && modal.dataset.photoId === id) $('memoryPhotoStatus').textContent = error.message || 'Фото недоступно. Проверьте подключение.'; }
    }
    async function movie() {
        const picked = photos().filter(photo => selected.has(photo.id)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
        if (picked.length < 2 || picked.length > STORY_MAX_PHOTOS) return;
        await run(async ctx => {
            const story = { id:createEntryId('story'),petId:ctx.pet,month:null,startDate:null,createdAt:new Date().toISOString(),photos:[],collageLayout:'grid',memoryMusic:'warm',memoryFormat:'portrait' };
            const created = [];
            try {
                for (const [index,photo] of picked.entries()) {
                    if (!current(ctx)) return;
                    message(`Готовлю фото для фильма: ${index+1} из ${picked.length}…`);
                    const blob = await PetCareFiles.download(bucket,photo.path,ctx.user);
                    if (!current(ctx)) return;
                    const path = `${ctx.user}/${story.id}/photo-${index+1}-${createEntryId('image')}.jpg`;
                    await PetCareFiles.upload(bucket,path,blob,{contentType:'image/jpeg'}); created.push(path);
                    if (!current(ctx)) return;
                    story.photos.push({week:index+1,path,date:photo.date,takenAt:photo.takenAt});
                }
                appData.storyProjects.push(story);
                try { await saveData(); } catch(error) { appData.storyProjects=appData.storyProjects.filter(row=>row.id!==story.id);throw error; }
                if (!current(ctx)) return;
                selected.clear(); renderStories(); message('Подборка готова ниже. Выберите музыку и формат, затем нажмите «Создать видео».');
                document.querySelector(`[data-story-card-id="${story.id}"]`)?.scrollIntoView({block:'start',behavior:'smooth'});
            } finally {
                if (activeUserId===ctx.user && !appData.storyProjects.some(row=>row.id===story.id) && created.length) await supabaseClient.storage.from(bucket).remove(created);
            }
        });
    }
    $('memoryLibraryUpload').addEventListener('click',()=>{if (!ready()||operation) return;const input=$('memoryLibraryInput');input.dataset.context=context;input.dataset.epoch=String(epoch);input.value='';input.click();});
    $('memoryLibraryInput').addEventListener('change',event=>upload(event.target));
    $('memoryLibraryMovie').addEventListener('click',movie);
    $('memoryLibraryClear').addEventListener('click',()=>{selected.clear();render();});
    $('memoryLibraryMonth').addEventListener('change',()=>{limit=24;render();});
    $('memoryLibraryMore').addEventListener('click',()=>{limit+=24;render();});
    modal.addEventListener('close',releasePreview);
    $('memoryPhotoSaveDate').addEventListener('click',()=>run(async ctx=>{
        const photo=find(modal.dataset.photoId),date=$('memoryPhotoDate');if(!photo||!date.validity.valid){$('memoryPhotoStatus').textContent='Проверьте дату фотографии или оставьте поле пустым.';return;}
        const album=albums().find(row=>row.id===photo.albumId),row=album.photos.find(row=>row.id===photo.id),old=row.date;row.date=date.value || null;
        try { await saveData(); } catch(error){row.date=old;throw error;}
        if(current(ctx)){$('memoryPhotoStatus').textContent='Дата сохранена.';render();}
    }));
    $('memoryPhotoDelete').addEventListener('click',()=>run(async ctx=>{
        const photo=find(modal.dataset.photoId);if(!photo||!confirm('Удалить фото из библиотеки? Фото в созданных фильмах останутся.'))return;
        const album=albums().find(row=>row.id===photo.albumId);const previous=album.photos;album.photos=album.photos.filter(row=>row.id!==photo.id);
        try { await saveData(); } catch(error){album.photos=previous;throw error;}
        if(!current(ctx))return;modal.close();selected.delete(photo.id);render();
        if(ownedPath(photo.path,ctx.user))await supabaseClient.storage.from(bucket).remove([photo.path]);
        message('Фото удалено из библиотеки.');
    }));
    $('memoryPhotoDownload').addEventListener('click',()=>run(async ctx=>{
        const photo=find(modal.dataset.photoId);if(!photo)return;
        const blob=await PetCareFiles.download(bucket,photo.path,ctx.user);if(!current(ctx))return;
        const name=`PetCare-photo-${photo.date || photo.id}.jpg`;
        if(window.PetCareNative)await PetCareNative.shareFile(blob,name);
        else triggerStoryCollageDownload(blob,name);
    }));
    window.addEventListener('petcare:account-reset',()=>{reset();$('memoryLibraryGrid').replaceChildren();message('');});
    window.addEventListener('petcare:data-changed',()=>{if($('storiesPage').style.display==='block')render();});
    window.PetCarePhotoLibrary={render};
})();
