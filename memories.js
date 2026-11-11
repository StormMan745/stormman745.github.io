// Runs only when the owner creates a movie. Photos and music are encoded locally.
import { Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, Quality, canEncodeVideo, canEncodeAudio } from 'mediabunny';

const FPS = 30, SHOT_SECONDS = 5, FADE_SECONDS = 1.1;
const abortError = () => new DOMException('Создание видео отменено.', 'AbortError');
function check(signal) { if (signal?.aborted) throw abortError(); }
const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };

function drawPhoto(ctx, image, elapsed, index, width, height) {
    // A soft background preserves the entire pet, even in a landscape photo.
    const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
    const progress = Math.max(0, Math.min(1, elapsed / SHOT_SECONDS));
    const zoom = 1.015 + (index % 2 ? 1 - progress : progress) * .045;
    const cover = Math.max(width / iw, height / ih) * 1.12;
    ctx.save();
    ctx.filter = `blur(${Math.round(width / 35)}px) brightness(.68)`;
    ctx.drawImage(image, (width - iw * cover) / 2, (height - ih * cover) / 2, iw * cover, ih * cover);
    ctx.filter = 'none';
    const fit = Math.min(width / iw, height / ih) * zoom;
    const x = (width - iw * fit) / 2 + (progress - .5) * width * .008 * (index % 2 ? -1 : 1);
    ctx.drawImage(image, x, (height - ih * fit) / 2, iw * fit, ih * fit);
    ctx.restore();
}

export function drawFrame(canvas, images, photos, title, month, time) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Браузер не смог подготовить видео.');
    const { width, height } = canvas, duration = images.length * SHOT_SECONDS;
    const current = Math.min(images.length - 1, Math.floor(Math.max(0, time) / SHOT_SECONDS));
    const local = Math.max(0, time - current * SHOT_SECONDS);
    ctx.fillStyle = '#131b18'; ctx.fillRect(0, 0, width, height);
    drawPhoto(ctx, images[current], local, current, width, height);
    const blend = current < images.length - 1 ? smooth((local - (SHOT_SECONDS - FADE_SECONDS)) / FADE_SECONDS) : 0;
    if (blend) {
        ctx.save(); ctx.globalAlpha = blend;
        drawPhoto(ctx, images[current + 1], local - SHOT_SECONDS, current + 1, width, height);
        ctx.restore();
    }
    const shade = ctx.createLinearGradient(0, height * .48, 0, height);
    shade.addColorStop(0, '#00000000'); shade.addColorStop(1, '#071811b8');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
    const pad = width * .065;
    ctx.save();
    ctx.globalAlpha = smooth(time / .9) * (1 - smooth((time - duration + 1.2) / 1.2));
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
    const landscape = width > height;
    const fontSize = Math.round(width * (landscape ? .07 : .095));
    ctx.font = `600 ${fontSize}px Arial, sans-serif`;
    let name = String(title || 'Мой питомец');
    while (ctx.measureText(name).width > width - pad * 2 && name.length > 1) name = name.slice(0, -1);
    if (name !== String(title || 'Мой питомец')) name = name.slice(0, -1) + '…';
    ctx.fillText(name, pad, height * (landscape ? .72 : .78));
    ctx.font = `${Math.round(width * .029)}px Arial, sans-serif`;
    ctx.fillText(String(month), pad, height * (landscape ? .82 : .83));
    ctx.restore();
    const fade = 1 - smooth(time / .55) + smooth((time - duration + .75) / .75);
    if (fade > 0) { ctx.fillStyle = `rgba(9,18,14,${Math.min(1, fade)})`; ctx.fillRect(0, 0, width, height); }
}

// An original, gently voiced melody; no external music service or microphone.
export function createMusic(duration, mood = 'warm', sampleRate = 44100) {
    const audio = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(duration * sampleRate), sampleRate });
    const left = audio.getChannelData(0), right = audio.getChannelData(1);
    const beat = mood === 'bright' ? .625 : .833333;
    const chords = [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 55]];
    const melody = mood === 'bright' ? [72, 76, 79, 76, 74, 72, 71, 67] : [67, 71, 72, 76, 74, 72, 71, 67];
    function note(midi, start, length, level, pan, soft = false) {
        const frequency = 440 * 2 ** ((midi - 69) / 12), first = Math.floor(start * sampleRate);
        const count = Math.min(Math.ceil(length * sampleRate), left.length - first);
        const l = Math.sqrt((1 - pan) / 2), r = Math.sqrt((1 + pan) / 2);
        for (let n = 0; n < count; n++) {
            const t = n / sampleRate, attack = Math.min(1, t / (soft ? .18 : .012));
            const release = Math.min(1, (length - t) / .3);
            const envelope = attack * release * Math.exp(-t / (soft ? 2.1 : .8));
            const phase = 2 * Math.PI * frequency * t;
            const wave = Math.sin(phase) + .22 * Math.sin(phase * 2) * Math.exp(-t * 2) + .06 * Math.sin(phase * 3);
            const value = wave * envelope * level;
            left[first + n] += value * l; right[first + n] += value * r;
        }
    }
    for (let bar = 0, at = 0; at < duration; bar++, at = bar * beat * 4) {
        const chord = chords[bar % chords.length];
        chord.forEach((pitch, i) => note(pitch, at + i * .04, beat * 4 + .4, .035, (i - 1.5) / 3, true));
        for (let step = 0; step < 8; step++) {
            const start = at + step * beat / 2;
            if (start < duration) note(chord[step % 4] + 12, start, 1.9, .07, step % 2 ? .2 : -.2);
        }
        if (at + beat < duration) note(melody[bar % melody.length], at + beat, beat * 2.5, .09, 0);
    }
    for (let i = 0; i < left.length; i++) {
        const time = i / sampleRate, gain = 1.15 * Math.min(1, time / 1.3, (duration - time) / 2.2);
        left[i] = Math.tanh(left[i] * gain); right[i] = Math.tanh(right[i] * gain);
    }
    return audio;
}

function canvasFor(format) {
    const canvas = document.createElement('canvas');
    canvas.width = format === 'landscape' ? 1280 : 720;
    canvas.height = format === 'landscape' ? 720 : 1280;
    return canvas;
}

async function encodeFrames(canvas, options, audio) {
    const { signal, onProgress, images, photos, title, month } = options;
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 2_000_000 }), keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: FPS });
    const sound = audio ? new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: 128_000 }) }) : null;
    if (sound) output.addAudioTrack(sound);
    try {
        await output.start();
        // Closing the audio source prevents unnecessary buffering of video packets.
        if (sound) { await sound.add(audio); sound.close(); }
        const frames = Math.round(images.length * SHOT_SECONDS * FPS);
        for (let i = 0; i < frames; i++) {
            check(signal);
            drawFrame(canvas, images, photos, title, month, i / FPS);
            await video.add(i / FPS, 1 / FPS);
            if (i % 12 === 0) { onProgress?.(i / frames); await new Promise(resolve => setTimeout(resolve, 0)); }
        }
        video.close(); check(signal); await output.finalize();
        return { blob: new Blob([target.buffer], { type: 'video/mp4' }), extension: 'mp4', duration: frames / FPS };
    } finally {
        if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    }
}

async function recordFrames(canvas, options, audio) {
    const { signal, images, photos, title, month, onProgress, audioContext } = options;
    if (!canvas.captureStream || !window.MediaRecorder) throw new Error('Этот браузер не поддерживает создание видео. Обновите браузер и попробуйте снова.');
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('Браузер не поддерживает запись видео. Попробуйте актуальную версию Safari или Chrome.');
    const duration = images.length * SHOT_SECONDS, stream = canvas.captureStream(FPS), chunks = [];
    let source, timer, wakeLock, recorder, rejectRecording, settled = false;
    const destination = audio && audioContext ? audioContext.createMediaStreamDestination() : null;
    if (audio && !destination) throw new Error('Не удалось подготовить музыку. Повторите создание видео.');
    if (destination) {
        await audioContext.resume();
        if (audioContext.state !== 'running') throw new Error('Браузер приостановил музыку. Нажмите «Создать видео» ещё раз.');
        source = audioContext.createBufferSource(); source.buffer = audio; source.connect(destination);
        destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    }
    try {
        try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
        check(signal);
        drawFrame(canvas, images, photos, title, month, 0);
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128_000 });
        const complete = new Promise((resolve, reject) => {
            rejectRecording = reject;
            recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
            recorder.onerror = () => reject(new Error('Запись видео прервалась. Попробуйте ещё раз.'));
            recorder.onstop = () => { if (!settled) { settled = true; resolve(); } };
        });
        const cancel = () => rejectRecording(abortError());
        const hidden = () => { if (document.hidden) rejectRecording(new Error('Создание приостановлено. Оставьте приложение открытым и повторите попытку.')); };
        signal?.addEventListener('abort', cancel, { once: true });
        document.addEventListener('visibilitychange', hidden);
        try {
            recorder.start(250);
            const start = performance.now();
            source?.start();
            function frame() {
                if (signal?.aborted) return cancel();
                const time = Math.min(duration, (performance.now() - start) / 1000);
                drawFrame(canvas, images, photos, title, month, time); onProgress?.(time / duration);
                if (time >= duration) recorder.stop();
                else timer = setTimeout(frame, 1000 / FPS);
            }
            frame(); await complete; check(signal);
        } finally {
            signal?.removeEventListener('abort', cancel); document.removeEventListener('visibilitychange', hidden);
        }
        const type = recorder.mimeType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
        return { blob: new Blob(chunks, { type }), extension: type === 'video/mp4' ? 'mp4' : 'webm', duration };
    } finally {
        clearTimeout(timer); settled = true;
        if (recorder?.state === 'recording') recorder.stop();
        try { source?.stop(); } catch {}
        source?.disconnect(); stream.getTracks().forEach(track => track.stop());
        await wakeLock?.release().catch(() => {});
    }
}

export async function create(options) {
    check(options.signal);
    if (options.images.length < 2 || options.images.length > 12) throw new Error('Выберите от 2 до 12 фотографий.');
    const canvas = canvasFor(options.format);
    const audio = options.music === 'none' ? null : createMusic(options.images.length * SHOT_SECONDS, options.music);
    const [videoSupported, audioSupported] = await Promise.all([
        canEncodeVideo('avc', { width: canvas.width, height: canvas.height, frameRate: FPS }).catch(() => false),
        audio ? canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 44100 }).catch(() => false) : true
    ]);
    check(options.signal);
    // MediaRecorder also covers Safari versions without AudioEncoder.
    const result = videoSupported && audioSupported
        ? await encodeFrames(canvas, options, audio)
        : await recordFrames(canvas, options, audio);
    check(options.signal);
    if (!result.blob.size || result.blob.size > 25 * 1024 * 1024) throw new Error('Не удалось подготовить видео подходящего размера. Попробуйте ещё раз.');
    drawFrame(canvas, options.images, options.photos, options.title, options.month, 1.5);
    result.poster = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
    options.onProgress?.(1);
    return result;
}

window.PetCareMemories = { create, drawFrame, createMusic };
