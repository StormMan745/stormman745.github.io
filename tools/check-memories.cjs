const assert=require('node:assert/strict'),fs=require('node:fs');
module.exports=async({page,context,profiles,uid,other,objects,base})=>{
  let rejectUpload=false;const uploads=[],removed=[];
  await context.route('https://qexiyikdmdbdxgusqnee.supabase.co/storage/v1/object/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS'};
    if(method==='OPTIONS')return route.fulfill({status:204,headers});
    let name=decodeURIComponent(url.pathname.replace('/storage/v1/object/','').replace(/^(authenticated|sign)\//,''));
    if(method==='POST'&&url.pathname.includes('/object/sign/'))return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({signedURL:'/object/sign/'+name+'?token=mock'})});
    if(method==='GET')return route.fulfill({status:objects.has(name)?200:404,headers,contentType:name.endsWith('.mp4')?'video/mp4':name.endsWith('.webm')?'video/webm':'image/jpeg',body:objects.get(name)||Buffer.from('missing')});
    if(method==='DELETE'){let body={};try{body=req.postDataJSON()}catch{};for(const path of body.prefixes||[]){removed.push(path);objects.delete(name+'/'+path);}return route.fulfill({status:200,headers,contentType:'application/json',body:'[]'});}
    if(method==='POST'&&/\.(mp4|webm)$/.test(name)){
      uploads.push(name);
      if(rejectUpload)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({message:'Temporary upload failure'})});
    }
    return route.fallback();
  });
  await context.route('https://qexiyikdmdbdxgusqnee.supabase.co/functions/v1/petcare-platform',async route=>{
    let body={};try{body=route.request().postDataJSON()}catch{}
    if(body?.action!=='trash-files')return route.fallback();
    for(const path of body.paths||[]){removed.push(path);objects.delete(body.bucket+'/'+path);}
    return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:'{"ok":true}'});
  });
  const photos=await page.evaluate(()=>Array.from({length:4},(_,i)=>{
    const c=document.createElement('canvas');c.width=i===0?1600:800;c.height=i===0?2000:1000;const x=c.getContext('2d');if(i===0)x.scale(2,2);
    x.fillStyle=['#c9b8a0','#6d907d','#d4ad88','#879bb4'][i];x.fillRect(0,0,800,1000);
    x.fillStyle='#e7d6ba';x.beginPath();x.ellipse(400,460,190,230,0,0,Math.PI*2);x.fill();
    x.fillStyle='#785a47';for(const px of [210,590]){x.beginPath();x.ellipse(px,390,70,150,px<400?.3:-.3,0,Math.PI*2);x.fill();}
    x.fillStyle='#302e29';for(const px of [330,470]){x.beginPath();x.ellipse(px,440,16,22,0,0,Math.PI*2);x.fill();}
    x.beginPath();x.ellipse(400,540,38,28,0,0,Math.PI*2);x.fill();
    x.fillStyle='#fff';x.font='50px Arial';x.fillText('Момент '+(i+1),55,880);
    return c.toDataURL('image/jpeg',.9).split(',')[1];
  }));
  await page.evaluate(()=>showStories());
  await page.locator('[data-pc-click="story-add"]').click();await page.locator('[data-pc-click="story-create"]').click();
  await page.waitForFunction(()=>appData.storyProjects.length===1&&PetCareSync.state.phase==='saved');
  assert.equal(await page.evaluate(()=>appData.storyProjects[0].month),null,'A memory does not require a month');
  assert.equal(await page.evaluate(()=>appData.storyProjects[0].startDate),null,'No reminder start date without reminders');
  assert.match(await page.locator('.story-card h3').innerText(),/без даты/);
  await page.locator('[data-pc-click="story-upload-many"]').click();
  await page.locator('#storyPhotoInput').setInputFiles(photos.map((b,i)=>({name:'pet-'+i+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from(b,'base64')})));
  await page.waitForFunction(()=>appData.storyProjects[0].photos.length===4&&storyOperationsInProgress.size===0,{},{timeout:20000}).catch(async error=>{console.log(await page.evaluate(()=>({stories:appData.storyProjects,status:document.querySelector('.story-status')?.textContent,busy:[...storyOperationsInProgress]})));throw error;});
  // Two shots in reverse date order first; chronology, true encoding and sound are real.
  await page.evaluate(()=>{const s=appData.storyProjects[0];s.photos=s.photos.slice(0,2);s.photos[0].date='2026-11-09';s.photos[1].date='2026-11-01';renderStories();});
  assert.equal(await page.evaluate(()=>getStoryPhotos(appData.storyProjects[0])[0].week),2);
  const generate=()=>page.locator('[data-pc-click="story-memory-generate"]').click();
  await generate();await page.waitForFunction(()=>!activeStoryMovie,{},{timeout:120000});
  const result=await page.evaluate(()=>{const s=appData.storyProjects[0];return{path:s.videoPath,mime:s.videoMime,duration:s.videoDuration,status:document.querySelector('.story-status').textContent};});
  assert(result.path,JSON.stringify(result));assert.equal(result.mime,'video/mp4');assert.equal(result.duration,10);
  const key='petcare-stories/'+result.path,bytes=objects.get(key);assert(bytes?.length>10000,'A real movie was uploaded');assert.equal(bytes.subarray(4,8).toString(),'ftyp');
  fs.writeFileSync('.tools/petcare-memory-test.mp4',bytes);
  const media=await page.evaluate(async path=>{
    const blob=storyMovieBlobCache.get(path),video=document.querySelector('.story-memory-video');
    if(video.readyState<1)await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject});
    const ctx=new AudioContext();const sound=await ctx.decodeAudioData(await blob.arrayBuffer());
    const samples=sound.getChannelData(0),rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
    await ctx.close();return{duration:video.duration,width:video.videoWidth,height:video.videoHeight,rms,channels:sound.numberOfChannels};
  },result.path);
  assert(Math.abs(media.duration-10)<.15,JSON.stringify(media));assert.equal(media.width,720);assert.equal(media.height,1280);assert(media.rms>.01,'The exported movie contains audible music');assert.equal(media.channels,2);
  await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});});
  const download=page.waitForEvent('download');await page.locator('[data-pc-click="story-memory-save"]').click();assert.match((await download).suggestedFilename(),/\.mp4$/);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Fits '+width);await page.locator('.story-card').screenshot({path:'.tools/memories-'+width+'.png'});}
  const oldPath=result.path;await page.locator('[data-pc-change="story-memory-music"]').selectOption('bright');assert.match(await page.locator('.story-status').innerText(),/изменились/);
  // Cancellation must not replace the saved movie or upload a partial file.
  const before=uploads.length;await generate();await page.waitForFunction(()=>activeStoryMovie&&window.PetCareMemories);await page.locator('[data-pc-click="story-memory-cancel"]').click();
  await page.waitForFunction(()=>!activeStoryMovie);assert.equal(uploads.length,before);assert.equal(await page.evaluate(()=>appData.storyProjects[0].videoPath),oldPath);
  rejectUpload=true;await generate();await page.waitForFunction(()=>!activeStoryMovie,{},{timeout:120000});
  assert.deepEqual(await page.evaluate(()=>({pending:appData.storyProjects[0].videoPending,previous:appData.storyProjects[0].previousVideoPath})),{pending:true,previous:oldPath},'A queued upload retains the confirmed movie');
  assert(objects.has('petcare-stories/'+oldPath),'Confirmed movie stays available during a failed upload');assert.match(await page.locator('.story-status').innerText(),/Ожидает отправки/);
  rejectUpload=false;await page.evaluate(async()=>{await PetCareFiles.flush();await refreshStoryMovieUploads();});await page.waitForFunction(()=>!appData.storyProjects[0].videoPending);
  // Landscape and no music use a second real encode; old media removed only after save.
  await page.waitForFunction(()=>!storyMoviesSyncing&&PetCareSync.state.phase==='saved');
  await page.locator('.story-photo-editor').evaluate(el=>{el.open=true;});await page.locator('[data-pc-click="story-upload-many"]').click();
  await page.locator('#storyPhotoInput').setInputFiles(photos.slice(2).map((b,i)=>({name:'later-'+i+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from(b,'base64')})));
  await page.waitForFunction(()=>appData.storyProjects[0].photos.length===4&&storyOperationsInProgress.size===0&&PetCareSync.state.phase==='saved');
  await page.locator('[data-pc-change="story-memory-music"]').selectOption('none');await page.locator('[data-pc-change="story-memory-format"]').selectOption('landscape');
  await generate();await page.waitForFunction(()=>!activeStoryMovie,{},{timeout:120000});
  const landscape=await page.evaluate(async()=>{const s=appData.storyProjects[0],v=document.querySelector('video.story-memory-video');if(v.readyState<1)await new Promise(r=>v.onloadedmetadata=r);return{path:s.videoPath,duration:s.videoDuration,width:v.videoWidth,height:v.videoHeight};});
  assert.notEqual(landscape.path,oldPath);assert.equal(landscape.duration,20);assert.equal(landscape.width,1280);assert.equal(landscape.height,720);assert(removed.includes(oldPath));
  await page.waitForFunction(()=>storyOperationsInProgress.size===0&&PetCareSync.state.phase==='saved');
  await page.locator('.story-photo-editor').evaluate(el=>{el.open=true;});await page.locator('[data-pc-click="story-upload-many"]').click();
  await page.locator('#storyPhotoInput').setInputFiles(Array.from({length:8},(_,i)=>({name:'extra-'+i+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from(photos[i%4],'base64')})));
  await page.waitForFunction(()=>appData.storyProjects[0].photos.length===12&&storyOperationsInProgress.size===0&&PetCareSync.state.phase==='saved');
  assert.equal(await page.locator('.story-week').count(),12);assert.equal(await page.locator('[data-pc-click="story-upload-many"]').count(),0);
  const resize=await page.evaluate(async()=>{const image=await loadStoryImage(appData.storyProjects[0].photos[0].path,1280);const max=Math.max(image.image.width,image.image.height);image.cleanup?.();URL.revokeObjectURL(image.objectUrl);return max;});assert.equal(resize,1280,'Large photos are resized before video encoding');
  await page.locator('[data-pc-change="story-memory-format"]').selectOption('portrait');await page.locator('[data-pc-change="story-memory-music"]').selectOption('warm');
  await generate();await page.waitForFunction(()=>!activeStoryMovie,{},{timeout:120000});
  const full=await page.evaluate(async()=>{const s=appData.storyProjects[0],v=document.querySelector('video.story-memory-video');if(v.readyState<1)await new Promise(r=>v.onloadedmetadata=r);return{duration:s.videoDuration,actual:v.duration,path:s.videoPath,count:getStoryPhotos(s).length};});
  assert.equal(full.count,12);assert.equal(full.duration,60);assert(Math.abs(full.actual-60)<.15);assert(objects.get('petcare-stories/'+full.path).length<25*1024*1024,'One-minute video fits the private storage limit');
  await page.evaluate(async()=>{appData.pets.push({id:'pet-two',name:'Другой питомец'});await saveData();switchPet('pet-two');showStories();});
  assert.equal(await page.locator('.story-card').count(),0,'Memories stay with their pet');assert.equal(profiles.get(other).data.storyProjects.length,0,'Another account is unchanged');
  const fallback=await context.newPage();
  await fallback.addInitScript(()=>{Object.defineProperty(window,'VideoEncoder',{configurable:true,value:undefined});Object.defineProperty(window,'AudioEncoder',{configurable:true,value:undefined});});
  await fallback.goto(base);await fallback.waitForFunction(()=>window.PetCareSync&&activeUserId);
  const compatibility=await fallback.evaluate(async photos=>{
    const runtime=await loadStoryMovieRuntime(),images=await Promise.all(photos.slice(0,2).map(data=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src='data:image/jpeg;base64,'+data;})));
    const ctx=new AudioContext();await ctx.resume();
    try {
      const movie=await runtime.create({images,photos:[],title:'Барни',month:'Ноябрь 2026',format:'landscape',music:'warm',audioContext:ctx});
      const decoded=await ctx.decodeAudioData(await movie.blob.arrayBuffer()),samples=decoded.getChannelData(0);
      return{type:movie.blob.type,size:movie.blob.size,duration:decoded.duration,rms:Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length)};
    }finally{await ctx.close();}
  },photos);
  assert.equal(compatibility.type,'video/mp4');assert(compatibility.size>10000);assert(Math.abs(compatibility.duration-10)<.5);assert(compatibility.rms>.01,'Recorder fallback preserves music');await fallback.close();
  await page.evaluate(()=>{switchPet('pet-one');showStories();window.savedMemoryCreate=PetCareMemories.create;PetCareMemories.create=options=>new Promise((resolve,reject)=>{window.waitingMemoryCancel=true;options.signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true});});});
  const uploadsBeforeLogout=uploads.length;await generate();await page.waitForFunction(()=>window.waitingMemoryCancel);
  await page.evaluate(()=>resetActiveAccountData());await page.waitForFunction(()=>!activeStoryMovie);
  assert.equal(uploads.length,uploadsBeforeLogout);assert.deepEqual(await page.evaluate(()=>[storyMovieBlobCache.size,storyMediaUrlCache.size]),[0,0],'Logout clears private memory caches');
  console.log('PASS: real MP4/AAC with audible stereo music, 2/4 shots, chronological order, 720p portrait/landscape, phone/desktop upload, cancellation, upload failure, save/download, old-file cleanup and account/pet isolation. Backend mocked. '+JSON.stringify(media));
  console.log('PASS: MediaRecorder compatibility export with music and abort on account reset. '+JSON.stringify(compatibility));
  console.log('PASS: twelve-photo upload, gradual slots, 1280px memory limit and a real one-minute MP4 with music. '+JSON.stringify(full));
};
