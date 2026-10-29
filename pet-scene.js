// Classic script so animated pets also work when opening index.html directly.
(() => {
const rendererUrl = new URL('./assets/vendor/three/three.runtime.min.js?v=20261029-animated-pets', document.currentScript.src).href;
let rendererPromise;
function loadRenderer() {
    if (window.PetCareThree) return Promise.resolve(window.PetCareThree);
    if (!rendererPromise) rendererPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = rendererUrl;
        script.onload = () => window.PetCareThree ? resolve(window.PetCareThree) : reject(new Error('Renderer unavailable'));
        script.onerror = () => { script.remove(); reject(new Error('Renderer unavailable')); };
        document.head.appendChild(script);
    }).catch(error => { rendererPromise = null; throw error; });
    return rendererPromise;
}
// A single canvas is shared by the visible pet card.
const slots = [...document.querySelectorAll('[data-pet-scene]')];
let enginePromise;
let activeSlot;
let currentAnimal;
let visible = false;
let animationId = 0;
let animationGeneration = 0;
let rotation = 0;
let tilt = 0;
let lastFrame = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const kinds = { '🐶': 'dog', '🐕': 'puppy', '🐱': 'cat', '🐰': 'rabbit', '🐹': 'hamster', '🐦': 'bird', '🦜': 'parrot', '🐢': 'turtle', '🐠': 'fish' };

async function createEngine() {
    const T = await loadRenderer();
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = 'pet-scene-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(2.4, 2.15, 5.8);
    camera.zoom = 1.05;
    camera.lookAt(0, 1.08, 0);
    scene.add(new T.HemisphereLight(0xfffcf0, 0xaab6a1, 2.1));
    const light = new T.DirectionalLight(0xfff4e3, 3.5);
    light.position.set(-3, 7, 5);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.left = light.shadow.camera.bottom = -3;
    light.shadow.camera.right = light.shadow.camera.top = 3;
    light.shadow.normalBias = 0.035;
    light.shadow.bias = -0.0001;
    light.shadow.radius = 4;
    scene.add(light);
    const rim = new T.DirectionalLight(0xd6e5ff, 2.4);
    rim.position.set(4, 3, -3);
    scene.add(rim);
    const modelRoot = new T.Group();
    scene.add(modelRoot);
    const materials = new Map();
    const geometry = new T.SphereGeometry(1, 32, 24);
    const mat = color => {
        if (!materials.has(color)) materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.02 }));
        return materials.get(color);
    };
    const mesh = (parent, shape, color, x, y, z, sx = 1, sy = 1, sz = 1) => {
        const item = new T.Mesh(shape, mat(color));
        item.position.set(x, y, z);
        item.scale.set(sx, sy, sz);
        item.castShadow = true;
        item.receiveShadow = true;
        parent.add(item);
        return item;
    };
    const ball = (parent, color, x, y, z, sx, sy = sx, sz = sx) => mesh(parent, geometry, color, x, y, z, sx, sy, sz);
    const curve = (parent, color, points, radius) => mesh(parent, new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), 24, radius, 10, false), color, 0, 0, 0);
    const cone = (parent, color, x, y, z, radius, height, depth = 1) => mesh(parent, new T.ConeGeometry(radius, height, 4, 1), color, x, y, z, 1, 1, depth);
    const pedestal = mesh(scene, new T.CylinderGeometry(1.06, 1.08, 0.16, 64), 0xd8dfcb, 0, -0.13, 0);
    const rimBase = mesh(scene, new T.CylinderGeometry(1.07, 1.09, 0.065, 64), 0x8ca78e, 0, -0.235, 0);
    pedestal.castShadow = rimBase.castShadow = false;
    const floor = new T.Mesh(new T.PlaneGeometry(12, 12), new T.ShadowMaterial({ opacity: 0.09 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.275;
    floor.receiveShadow = true;
    scene.add(floor);
    let pet;
    let tail;
    let earGroup;
    const eye = (parent, x, y, z, scale = 1) => {
        ball(parent, 0x292c2c, x, y, z, 0.065 * scale, 0.09 * scale, 0.047 * scale);
        ball(parent, 0xffffff, x - 0.016 * scale, y + 0.028 * scale, z + 0.038 * scale, 0.021 * scale);
    };
    const muzzle = (head, base, noseColor = 0x382e2a, scale = 1) => {
        ball(head, base, -0.115, -0.14, 0.49, 0.205 * scale, 0.15 * scale, 0.14 * scale);
        ball(head, base, 0.115, -0.14, 0.49, 0.205 * scale, 0.15 * scale, 0.14 * scale);
        ball(head, noseColor, 0, -0.085, 0.614, 0.095, 0.065, 0.057);
        curve(head, 0x624a40, [[0, -0.12, 0.618], [0, -0.21, 0.621], [-0.07, -0.235, 0.606]], 0.012);
        curve(head, 0x624a40, [[0, -0.21, 0.621], [0.07, -0.235, 0.606]], 0.012);
    };
    const collar = (parent, y, radius = 0.32, color = 0x387e6a) => {
        const ring = mesh(parent, new T.TorusGeometry(radius, 0.065, 12, 48), color, 0, y, 0);
        ring.rotation.x = Math.PI / 2;
        ball(parent, 0xe8bf72, 0, y - 0.105, radius + 0.055, 0.07, 0.09, 0.035);
    };

    function buildAnimal(kind) {
        if (pet) {
            pet.traverse(item => { if (item.isMesh && item.geometry !== geometry) item.geometry.dispose(); });
            modelRoot.remove(pet);
        }
        pet = new T.Group();
        modelRoot.add(pet);
        tail = earGroup = null;
        const cream = 0xffe6bd, pink = 0xe9a39d;
        if (['dog', 'puppy', 'cat', 'rabbit', 'hamster'].includes(kind)) {
            const cat = kind === 'cat', rabbit = kind === 'rabbit', hamster = kind === 'hamster', puppy = kind === 'puppy';
            const fur = cat ? 0xdb9370 : rabbit ? 0xf4ece0 : hamster ? 0xdca262 : 0xe7b171;
            const dark = cat ? 0xab6950 : 0x9a6445;
            const head = new T.Group();
            head.position.set(0, hamster ? 1.1 : 1.48, 0.08);
            head.rotation.z = -0.07;
            pet.add(head);
            ball(pet, fur, 0, hamster ? 0.55 : 0.64, -0.05, hamster ? 0.58 : 0.44, hamster ? 0.54 : 0.62, 0.4);
            ball(pet, cream, 0, 0.57, 0.27, 0.30, 0.42, 0.155);
            for (const side of [-1, 1]) {
                ball(pet, fur, side * 0.37, 0.18, 0.06, 0.23, 0.23, 0.28);
                ball(pet, rabbit ? cream : fur, side * 0.23, 0.22, 0.32, 0.16, 0.27, 0.20);
                for (let toe = -1; toe <= 1; toe++) ball(pet, cream, side * 0.23 + toe * 0.055, 0.08, 0.445, 0.035, 0.034, 0.043);
            }
            ball(head, fur, 0, 0, 0, hamster ? 0.61 : 0.59, hamster ? 0.48 : 0.53, 0.51);
            if (puppy) head.scale.setScalar(1.12);
            for (const side of [-1, 1]) {
                eye(head, side * 0.22, 0.04, 0.465, puppy ? 1.12 : 1);
                ball(head, pink, side * 0.36, -0.14, 0.407, 0.075, 0.04, 0.025);
                if (cat) {
                    const outer = cone(head, fur, side * 0.4, 0.49, -0.015, 0.25, 0.53, 0.65);
                    outer.rotation.z = side * -0.22;
                    const inner = cone(head, pink, side * 0.4, 0.51, 0.09, 0.16, 0.31, 0.24);
                    inner.rotation.z = side * -0.22;
                    for (const y of [-0.11, -0.20]) curve(head, 0x8f614a, [[side * 0.28, y, 0.52], [side * 0.5, y - 0.02, 0.51], [side * 0.68, y + 0.03, 0.47]], 0.009);
                } else if (rabbit) {
                    const ear = new T.Group(); ear.position.set(side * 0.26, 0.53, -0.06); ear.rotation.z = side * -0.18; head.add(ear);
                    ball(ear, fur, 0, 0.30, 0, 0.16, 0.48, 0.12);
                    ball(ear, pink, 0, 0.31, 0.095, 0.085, 0.34, 0.04);
                } else if (hamster) {
                    ball(head, fur, side * 0.43, 0.35, -0.06, 0.19, 0.21, 0.12);
                    ball(head, pink, side * 0.43, 0.36, 0.04, 0.115, 0.13, 0.04);
                    ball(head, cream, side * 0.31, -0.17, 0.34, 0.23, 0.18, 0.18);
                } else {
                    const ear = ball(head, dark, side * 0.52, -0.055, -0.055, 0.19, puppy ? 0.39 : 0.43, 0.24);
                    ear.rotation.z = side * 0.23;
                    ball(head, fur, side * 0.22, 0.22, 0.45, 0.11, 0.04, 0.03);
                }
            }
            muzzle(head, cream, cat || rabbit || hamster ? 0xbb7f76 : 0x392f2c, hamster ? 0.9 : 1);
            if (kind === 'dog' || puppy) ball(head, 0xdc8b91, 0.07, -0.27, 0.57, 0.075, 0.09, 0.045);
            if (cat) {
                for (let i = -1; i <= 1; i++) { const stripe = ball(head, dark, i * 0.13, 0.32, 0.381, 0.035, 0.12, 0.022); stripe.rotation.z = i * -0.25; }
                tail = curve(pet, fur, [[-0.32, 0.30, -0.25], [-0.73, 0.30, -0.2], [-0.87, 0.85, -0.15], [-0.77, 1.13, -0.13]], 0.11);
                collar(pet, 1.04, 0.31, 0x899cb4);
            } else if (rabbit || hamster) {
                ball(pet, cream, 0.36, 0.35, -0.40, 0.18);
                if (hamster) {
                    ball(pet, fur, -0.21, 0.6, 0.43, 0.13, 0.16, 0.12);
                    ball(pet, fur, 0.21, 0.6, 0.43, 0.13, 0.16, 0.12);
                    ball(pet, 0xb68b51, 0, 0.57, 0.51, 0.15, 0.18, 0.1);
                }
            } else {
                tail = curve(pet, fur, [[-0.28, 0.40, -0.28], [-0.66, 0.63, -0.38], [-0.74, 0.96, -0.32]], 0.12);
                collar(pet, 1.01);
            }
            if (rabbit) pet.scale.setScalar(0.87);
            if (hamster) pet.scale.setScalar(1.10);
        } else if (kind === 'bird' || kind === 'parrot') {
            const parrot = kind === 'parrot', body = parrot ? 0x61a891 : 0x7eacc1, wing = parrot ? 0x3b817d : 0x547caa;
            ball(pet, body, 0, 0.80, 0, 0.46, 0.63, 0.42);
            ball(pet, parrot ? 0xcce6a5 : 0xd8e7d7, 0, 0.75, 0.30, 0.31, 0.41, 0.15);
            ball(pet, body, 0, 1.5, 0.07, 0.46, 0.47, 0.43);
            for (const side of [-1, 1]) {
                const w = ball(pet, wing, side * 0.39, 0.83, -0.04, 0.19, 0.46, 0.30); w.rotation.z = side * 0.22;
                ball(pet, 0xf2e6c7, side * 0.21, 1.51, 0.41, 0.13, 0.16, 0.055);
                eye(pet, side * 0.21, 1.51, 0.454, 0.87);
                ball(pet, 0xe8ba70, side * 0.2, 0.13, 0.16, 0.085, 0.11, 0.09);
                for (let toe = -1; toe <= 1; toe++) ball(pet, 0xe8ba70, side * 0.2 + toe * 0.06, 0.065, 0.25, 0.035, 0.04, 0.13);
            }
            const beak = ball(pet, parrot ? 0xe2aa58 : 0xf2c15b, 0, 1.35, 0.50, 0.15, 0.18, 0.20); beak.rotation.x = -0.35;
            ball(pet, 0xac764c, 0, 1.25, 0.51, 0.09, 0.09, 0.12);
            for (let i = -1; i <= 1; i++) { const plume = ball(pet, parrot ? 0x81b7a0 : body, i * 0.10, 1.94 + (i === 0 ? 0.07 : 0), -0.03, 0.07, 0.19, 0.10); plume.rotation.z = -i * 0.26; }
            tail = new T.Group(); pet.add(tail);
            for (let i = -1; i <= 1; i++) { const feather = ball(tail, wing, i * 0.12, 0.46, -0.44, 0.09, 0.45, 0.12); feather.rotation.x = -0.55; }
        } else if (kind === 'turtle') {
            const green = 0x91b492;
            for (const x of [-0.5, 0.5]) for (const z of [-0.35, 0.4]) ball(pet, green, x, 0.18, z, 0.21, 0.18, 0.25);
            ball(pet, 0xdfd6a9, 0, 0.34, -0.08, 0.63, 0.22, 0.67);
            ball(pet, 0x427d65, 0, 0.5, -0.13, 0.62, 0.48, 0.63);
            ball(pet, 0x64966b, 0, 0.91, -0.13, 0.27, 0.095, 0.31);
            for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const plate = ball(pet, i % 2 ? 0x7ba277 : 0x60956a, Math.cos(a) * 0.41, 0.69, -0.13 + Math.sin(a) * 0.42, 0.19, 0.17, 0.21); plate.rotation.y = -a; }
            ball(pet, green, 0, 0.65, 0.67, 0.34, 0.33, 0.37);
            for (const s of [-1, 1]) { eye(pet, s * 0.17, 0.73, 0.955, 0.82); ball(pet, 0xdfb59d, s * 0.23, 0.57, 0.91, 0.065, 0.035, 0.025); }
            curve(pet, 0x4c725c, [[-0.08, 0.54, 1.005], [0, 0.51, 1.018], [0.08, 0.54, 1.005]], 0.012);
            pet.scale.setScalar(1.35);
            pet.position.y = 0.04;
        } else {
            ball(pet, 0xf0af71, 0, 1.0, 0, 0.63, 0.48, 0.38);
            ball(pet, 0xffddb4, 0.12, 0.88, 0.12, 0.46, 0.26, 0.28);
            tail = new T.Group(); tail.position.set(-0.55, 1, 0); pet.add(tail);
            for (const y of [-1, 1]) { const fin = ball(tail, 0xdf8767, -0.18, y * 0.20, 0, 0.27, 0.29, 0.06); fin.rotation.z = y * -0.42; }
            ball(pet, 0xe88f6b, 0, 1.42, -0.02, 0.3, 0.14, 0.07);
            const fin = ball(pet, 0xdd8869, 0, 0.98, 0.37, 0.22, 0.16, 0.06); fin.rotation.z = -0.5;
            ball(pet, 0xfff3d7, 0.39, 1.11, 0.27, 0.17, 0.18, 0.10);
            eye(pet, 0.42, 1.12, 0.345, 1.1);
            ball(pet, 0xdb8467, 0.59, 0.99, 0.035, 0.08, 0.065, 0.075);
            for (const [x, y, z, r] of [[0.7,1.65,0,0.07],[-0.55,1.8,0,0.10],[0.8,1.9,-0.2,0.045]]) ball(pet, 0xb7d8d5, x,y,z,r);
        }
        modelRoot.rotation.y = -0.1;
    }

    function resize() {
        if (!activeSlot) return;
        const width = activeSlot.clientWidth, height = activeSlot.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    }
    const resizeObserver = new ResizeObserver(resize);
    function attach(slot) {
        resizeObserver.disconnect();
        slot.prepend(renderer.domElement);
        resizeObserver.observe(slot);
        slots.forEach(item => item.classList.toggle('has-model', item === slot));
        resize();
    }
    function draw(time = 0, snap = false) {
        const gentle = reducedMotion.matches;
        modelRoot.rotation.y += ((rotation + tilt - 0.1) - modelRoot.rotation.y) * (snap ? 1 : 0.10);
        if (pet) pet.rotation.z = gentle ? 0 : Math.sin(time * 0.0008) * 0.014;
        if (tail) tail.rotation.y = gentle ? 0 : Math.sin(time * 0.0022) * 0.14;
        renderer.render(scene, camera);
    }
    renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        cancelAnimationFrame(animationId);
        activeSlot?.classList.remove('has-model');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => { activeSlot?.classList.add('has-model'); resize(); resume(); });
    return { attach, buildAnimal, draw, resize };
}

function resume() {
    const generation = ++animationGeneration;
    cancelAnimationFrame(animationId);
    if (!visible || document.hidden || !enginePromise) return;
    enginePromise.then(engine => {
        if (!engine || !visible || document.hidden || generation !== animationGeneration) return;
        if (reducedMotion.matches) { engine.draw(); return; }
        const tick = time => {
            if (!visible || document.hidden || generation !== animationGeneration) return;
            if (time - lastFrame > 32) { engine.draw(time); lastFrame = time; }
            animationId = requestAnimationFrame(tick);
        };
        animationId = requestAnimationFrame(tick);
    });
}

async function chooseSlot() {
    const slot = slots.find(item => !item.hidden && item.getClientRects().length && item.closest('.page')?.style.display !== 'none');
    if (!slot) { visible = false; cancelAnimationFrame(animationId); return; }
    const animal = kinds[slot.dataset.animal] || 'dog';
    const sameModel = activeSlot === slot && currentAnimal === animal;
    activeSlot = slot;
    currentAnimal = animal;
    const rect = slot.getBoundingClientRect();
    visible = rect.bottom > 0 && rect.top < innerHeight;
    if (sameModel && enginePromise) { resume(); return; }
    if (!enginePromise && !visible) return;
    if (!enginePromise) enginePromise = createEngine().catch(error => { enginePromise = null; console.warn('PetCare 3D unavailable:', error.name); return null; });
    const engine = await enginePromise;
    if (!engine || activeSlot !== slot || currentAnimal !== animal) return;
    rotation = tilt = 0;
    engine.attach(slot);
    engine.buildAnimal(animal);
    engine.draw();
    resume();
}

const visibilityObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.target === activeSlot) {
        visible = entry.isIntersecting;
        if (visible && !enginePromise) chooseSlot();
        else resume();
    }
});
const mutationObserver = new MutationObserver(chooseSlot);
slots.forEach(slot => {
    visibilityObserver.observe(slot);
    mutationObserver.observe(slot, { attributes: true, attributeFilter: ['data-animal', 'hidden'] });
    slot.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || slot !== activeSlot || reducedMotion.matches) return;
        const rect = slot.getBoundingClientRect(); tilt = ((event.clientX - rect.left) / rect.width - 0.5) * 0.45;
    });
    slot.addEventListener('pointerleave', () => { tilt = 0; });
    slot.querySelector('[data-pet-rotate]')?.addEventListener('click', () => {
        rotation += Math.PI / 2;
        if (reducedMotion.matches) enginePromise?.then(engine => engine?.draw(0, true));
    });
});
document.querySelectorAll('.page').forEach(page => mutationObserver.observe(page, { attributes: true, attributeFilter: ['style'] }));
document.addEventListener('visibilitychange', resume);
reducedMotion.addEventListener('change', resume);
chooseSlot();
})();
