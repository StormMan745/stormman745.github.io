// ==============================
// SUPABASE
// ==============================

const SUPABASE_URL = "https://qexiyikdmdbdxgusqnee.supabase.co";
const SUPABASE_KEY = "sb_publishable_HSR87zEuGFNjwEYoa-zrSw_cTWchorw";
const STORY_STORAGE_BUCKET = "petcare-stories";
const ASSISTANT_DISPLAY_NAME = "PetCare ассистент";
const PUSH_VAPID_PUBLIC_KEY = "BNYHRT4U9ZG-jFDEBAR2MVz0Z-4-4W3BWaCNpR-tMqnlXZ2OHH3DavEBOyyC1Ph5VLbsakWuewhUpwCiZwciKd8";

const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);


// ==============================
// ЛОКАЛЬНЫЕ ДАННЫЕ
// ==============================

const STORAGE_KEY = "petcareData";
const CLOUD_TABLE = "petcare_data";
let activeUserId = null;
let cloudSaveQueue = Promise.resolve();
let activeDataLoadToken = 0;
const storyMediaUrlCache = new Map();
const storyCollageBlobCache = new Map();
const storyOperationsInProgress = new Set();
let activeAssistantRequest = null;
let assistantLiveChannel = null;
let assistantLiveTimer = null;
let assistantLiveController = null;
let assistantLiveRefresh = null;
let assistantLiveGeneration = 0;
let assistantLive = { userId: null, petId: null, snapshot: null, answerContext: null, localKey: null, cloudKey: null, localDirty: false, phase: "loading", connected: false, refreshAgain: false };
const profilePendingWrites = new Map();

function createInitialAppData() {
    return {
        pet: {
            id: "legacy-default",
            name: "Барни",
            breed: "Золотистый ретривер",
            weight: "28",
            animal: "🐶",
            dbId: null
        },
        pets: [],
        activePetId: null,
        healthRecords: [],
        reminders: [],
        completedTasks: [],
        activityHistory: [],
        assistantConversation: [],
        storyProjects: []
    };
}

let appData = createInitialAppData();
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = getLocalDateInputValue();
let historyReturnPageId = "homePage";

function resetActiveAccountData() {
    cancelAssistantRequest();
    stopAssistantProfileLive();
    activeDataLoadToken += 1;
    activeUserId = null;
    storyMediaUrlCache.forEach(item => {
        if (item.url?.startsWith("blob:")) URL.revokeObjectURL(item.url);
    });
    storyMediaUrlCache.clear();
    storyCollageBlobCache.clear();
    appData = createInitialAppData();
    document.getElementById("assistantMessages")?.replaceChildren();
    const assistantInput = document.getElementById("assistantQuestion");
    if (assistantInput) assistantInput.value = "";
}

function getPetKey(pet) {
    return String(pet?.dbId ?? pet?.id ?? "legacy-default");
}

function getActivePetKey() {
    return getPetKey(appData.pet);
}

function createEntryId(prefix) {
    const uniqueId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${uniqueId}`;
}

function normalizeAppData() {
    const previousPet = appData.pet && typeof appData.pet === "object"
        ? { ...appData.pet }
        : null;
    const petsById = new Map();

    (Array.isArray(appData.pets) ? appData.pets : []).forEach(pet => {
        if (!pet || typeof pet !== "object") return;
        const normalizedPet = { ...pet };
        if (!normalizedPet.id) normalizedPet.id = normalizedPet.dbId ?? `pet-${Date.now()}`;
        normalizedPet.weightHistory = Array.isArray(normalizedPet.weightHistory)
            ? normalizedPet.weightHistory
            : (Number(normalizedPet.weight) > 0
                ? [{ id: `initial-${getPetKey(normalizedPet)}`, date: getLocalDateInputValue(), value: Number(normalizedPet.weight) }]
                : []);
        petsById.set(getPetKey(normalizedPet), normalizedPet);
    });

    if (previousPet) {
        const previousKey = getPetKey(previousPet);
        const existing = petsById.get(previousKey);
        petsById.set(previousKey, { ...(existing || {}), ...previousPet, id: previousPet.id || previousPet.dbId || previousKey });
    }

    if (!petsById.size) {
        const fallbackPet = previousPet || {
            id: "legacy-default",
            name: "Барни",
            breed: "Золотистый ретривер",
            weight: "28",
            animal: "🐶",
            dbId: null
        };
        petsById.set(getPetKey(fallbackPet), fallbackPet);
    }

    const pets = [...petsById.values()];
    pets.forEach(pet => {
        if (!Array.isArray(pet.weightHistory)) {
            pet.weightHistory = Number(pet.weight) > 0
                ? [{ id: `initial-${getPetKey(pet)}`, date: getLocalDateInputValue(), value: Number(pet.weight) }]
                : [];
        }
        pet.weightHistory = pet.weightHistory.map(entry => ({
            ...entry,
            id: entry.id ?? createEntryId("weight")
        }));
    });
    const desiredId = appData.activePetId == null
        ? (previousPet ? getPetKey(previousPet) : getPetKey(pets[0]))
        : String(appData.activePetId);
    const activePet = pets.find(pet => getPetKey(pet) === desiredId) || pets[0];

    appData.pets = pets;
    appData.pet = activePet;
    appData.activePetId = getPetKey(activePet);
    appData.healthRecords = Array.isArray(appData.healthRecords) ? appData.healthRecords : [];
    appData.reminders = Array.isArray(appData.reminders) ? appData.reminders : [];
    appData.completedTasks = Array.isArray(appData.completedTasks) ? appData.completedTasks : [];
    appData.activityHistory = Array.isArray(appData.activityHistory) ? appData.activityHistory : [];
    appData.assistantConversation = Array.isArray(appData.assistantConversation) ? appData.assistantConversation : [];
    appData.storyProjects = Array.isArray(appData.storyProjects) ? appData.storyProjects : [];

    const legacyPetId = previousPet ? getPetKey(previousPet) : getPetKey(activePet);
    const legacyTaskIds = new Map([
        ["Кормление", "feeding"],
        ["Прогулка", "walk"],
        ["Витамины", "vitamins"]
    ]);
    appData.completedTasks = appData.completedTasks.map(task => {
        if (typeof task === "string") {
            return {
                id: legacyTaskIds.get(task) || task,
                date: getLocalDateInputValue(),
                petId: getActivePetKey()
            };
        }
        if (!task || typeof task !== "object") return null;
        return {
            id: String(task.id ?? task.taskId ?? ""),
            date: String(task.date ?? getLocalDateInputValue()),
            petId: String(task.petId ?? legacyPetId)
        };
    }).filter(task => task && task.id && task.date && task.petId);

    appData.healthRecords = appData.healthRecords.map(record => ({
        ...record,
        id: record.id ?? createEntryId("health"),
        petId: record.petId == null ? legacyPetId : String(record.petId)
    }));
    appData.reminders = appData.reminders.map(reminder => ({
        ...reminder,
        id: reminder.id ?? createEntryId("reminder"),
        petId: reminder.petId == null ? legacyPetId : String(reminder.petId),
        repeat: reminder.repeat || "once",
        completed: Boolean(reminder.completed),
        completedForDate: reminder.completedForDate || null
    }));
    appData.activityHistory = appData.activityHistory.map(event => ({
        ...event,
        id: String(event.id || `event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
        date: String(event.date || getLocalDateInputValue()),
        petId: String(event.petId ?? legacyPetId)
    }));
}


// ==============================
// СОХРАНЕНИЕ ДАННЫХ
// ==============================

function saveData() {
    if (!activeUserId) return Promise.resolve();
    updateHomeOverview();

    const userId = activeUserId;
    const snapshot = JSON.parse(JSON.stringify(appData));
    const activePhotoRecord = snapshot.pets?.find(pet =>
        getPetKey(pet) === getPetKey(snapshot.pet)
    );
    if (activePhotoRecord?.photoData && snapshot.pet) {
        delete snapshot.pet.photoData;
    }

    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify(snapshot));
    notifyAssistantLocalChange(snapshot, userId);
    profilePendingWrites.set(userId, (profilePendingWrites.get(userId) || 0) + 1);

    cloudSaveQueue = cloudSaveQueue
        .catch(() => {})
        .then(async () => {
            const { error } = await supabaseClient
                .from(CLOUD_TABLE)
                .upsert({
                    user_id: userId,
                    data: snapshot,
                    updated_at: new Date().toISOString()
                }, { onConflict: "user_id" });

            if (error) throw error;
            return true;
        })
        .catch(error => {
            console.error("Не удалось сохранить данные в Supabase. Локальная копия сохранена:", error);
            return false;
        })
        .then(synced => {
            const remaining = Math.max(0, (profilePendingWrites.get(userId) || 1) - 1);
            if (remaining) profilePendingWrites.set(userId, remaining);
            else profilePendingWrites.delete(userId);
            if (activeUserId === userId && assistantLive.userId === userId && !remaining) {
                const savedKey = getAssistantLocalProfileKey(snapshot, assistantLive.petId);
                const profileChanged = synced && savedKey !== assistantLive.cloudKey;
                if (synced) assistantLive.cloudKey = savedKey;
                if (synced && assistantLive.localKey === savedKey) assistantLive.localDirty = false;
                assistantLive.phase = synced ? (assistantLive.snapshot ? "ready" : "loading") : "error";
                updateAssistantProfileStatus();
                if (profileChanged) scheduleAssistantProfileRefresh(0);
            }
            return synced;
        });

    return cloudSaveQueue;
}


// ==============================
// ЗАГРУЗКА ДАННЫХ
// ==============================

function loadData() {
    if (!activeUserId) return;

    const savedData = localStorage.getItem(`${STORAGE_KEY}:${activeUserId}`);

    if (!savedData) {
        return;
    }

    try {
        const parsedData = JSON.parse(savedData);

        appData = {
            ...appData,
            ...parsedData
        };
        normalizeAppData();
    } catch (error) {
        console.error("Ошибка загрузки данных:", error);
    }
}

function applyAccountData(savedData) {
    const defaults = createInitialAppData();

    appData = {
        ...defaults,
        ...savedData,
        pet: { ...defaults.pet, ...(savedData.pet || {}) },
        healthRecords: Array.isArray(savedData.healthRecords) ? savedData.healthRecords : [],
        reminders: Array.isArray(savedData.reminders) ? savedData.reminders : [],
        completedTasks: Array.isArray(savedData.completedTasks) ? savedData.completedTasks : [],
        activityHistory: Array.isArray(savedData.activityHistory) ? savedData.activityHistory : [],
        assistantConversation: Array.isArray(savedData.assistantConversation) ? savedData.assistantConversation : [],
        storyProjects: Array.isArray(savedData.storyProjects) ? savedData.storyProjects : []
    };
    normalizeAppData();
}

async function loadDataFromDatabase(userId) {
    cancelAssistantRequest();
    stopAssistantProfileLive();
    const loadToken = ++activeDataLoadToken;
    activeUserId = userId;
    appData = createInitialAppData();

    const userStorageKey = `${STORAGE_KEY}:${userId}`;
    let savedData = localStorage.getItem(userStorageKey);
    const legacyData = localStorage.getItem(STORAGE_KEY);

    // Claim old browser-only data for the first signed-in account exactly once.
    if (legacyData) {
        if (!savedData) {
            localStorage.setItem(userStorageKey, legacyData);
            savedData = legacyData;
        }
        localStorage.removeItem(STORAGE_KEY);
    }

    if (savedData) {
        try {
            applyAccountData(JSON.parse(savedData));
        } catch (error) {
            console.error("Не удалось прочитать локальную копию данных:", error);
        }
    }

    const { data, error } = await supabaseClient
        .from(CLOUD_TABLE)
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();

    if (loadToken !== activeDataLoadToken || activeUserId !== userId) return;

    if (error) {
        console.error("Не удалось загрузить данные из Supabase; используется локальная копия:", error);
    } else if (data && data.data) {
        const needsCompletionMigration = Array.isArray(data.data.completedTasks)
            && data.data.completedTasks.some(task => typeof task === "string");
        applyAccountData(data.data);
        if (needsCompletionMigration) await saveData();
    } else if (savedData) {
        // First sign-in after the upgrade: migrate this browser's saved data to the account.
        normalizeAppData();
        await saveData();
    }

    if (loadToken !== activeDataLoadToken || activeUserId !== userId) return;

    normalizeAppData();
    localStorage.setItem(userStorageKey, JSON.stringify(appData));
}


// ==============================
// СКРЫТЬ ВСЕ СТРАНИЦЫ
// ==============================

function hideAllPages() {
    const pages = document.querySelectorAll(".page");

    pages.forEach(page => {
        page.style.display = "none";
    });
    document.querySelectorAll('.bottom-menu [aria-current="page"]').forEach(link => link.removeAttribute("aria-current"));
}

function markActiveNavigation(action) {
    document.querySelectorAll(".bottom-menu a").forEach(link => {
        if (link.dataset.pcClick === action) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
}


// ==============================
// ГЛАВНАЯ
// ==============================

function showHome() {
    hideAllPages();
    markActiveNavigation("nav-home");

    const homePage = document.getElementById("homePage");

    if (homePage) {
        homePage.style.display = "block";
    }

    restoreTasks();
    renderHomeReminders();
}


// ==============================
// СТРАНИЦА ПИТОМЦА
// ==============================

function showPet() {
    hideAllPages();
    markActiveNavigation("nav-pet");

    const petPage = document.getElementById("petPage");

    if (petPage) {
        petPage.style.display = "block";
    }

    updatePetOnScreen();
}


// ==============================
// ЗДОРОВЬЕ
// ==============================

function showHealth() {
    hideAllPages();
    markActiveNavigation("nav-health");

    const healthPage = document.getElementById("healthPage");

    if (healthPage) {
        healthPage.style.display = "block";
    }

    updatePetOnScreen();
    renderHealthRecords();
    const weightDateInput = document.getElementById("weightLogDate");
    if (weightDateInput && !weightDateInput.value) weightDateInput.value = getLocalDateInputValue();
}


// ==============================
// НАПОМИНАНИЯ
// ==============================

function showReminders() {
    hideAllPages();
    markActiveNavigation("nav-reminders");

    const remindersPage = document.getElementById("remindersPage");

    if (remindersPage) {
        remindersPage.style.display = "block";
    }

    renderReminders();
    renderCalendar();
    renderPushSettings();
}

function showStories() {
    hideAllPages();
    markActiveNavigation("nav-stories");
    const page = document.getElementById("storiesPage");
    if (page) page.style.display = "block";
    renderStories();
}


// ==============================
// ПРОФИЛЬ
// ==============================

function showProfile() {
    hideAllPages();
    markActiveNavigation("nav-profile");

    const profilePage = document.getElementById("profilePage");

    if (profilePage) {
        profilePage.style.display = "block";
    }

    loadUserProfile();
}


// ==============================
// ФОРМА ПИТОМЦА
// ==============================

let petFormMode = "edit";
let petFormReturnPage = "petPage";
let pendingPetPhoto;
let pendingHealthPhotos = [];
let pendingReminderPhotos = [];
let photoSelectionTasks = { health: Promise.resolve(), reminder: Promise.resolve() };
let photoSelectionTokens = { health: 0, reminder: 0 };

function renderPetAvatar(element, pet) {
    if (!element) return;
    element.replaceChildren();
    element.classList.toggle("has-photo", Boolean(pet?.photoData));

    if (pet?.photoData) {
        const image = document.createElement("img");
        image.src = pet.photoData;
        image.alt = pet.name ? `Фото питомца ${pet.name}` : "Фото питомца";
        element.appendChild(image);
        return;
    }

    element.textContent = pet?.animal || "🐾";
}


function compressPetPhoto(file, maxSide = 720, quality = 0.78) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Не удалось прочитать файл фотографии."));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("Не удалось открыть изображение."));
            image.onload = () => {
                const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext("2d");
                if (!context) {
                    reject(new Error("Не удалось обработать изображение."));
                    return;
                }
                context.fillStyle = "#ffffff";
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function getAttachmentPhotos(item) {
    const photos = Array.isArray(item?.photos) && item.photos.length
        ? item.photos
        : (item?.photoData ? [item.photoData] : []);
    return photos.filter(photo => typeof photo === "string" && photo.startsWith("data:image/"));
}

function appendAttachmentPhotos(container, item, altText) {
    const photos = getAttachmentPhotos(item);
    if (!photos.length) return;

    const gallery = document.createElement("div");
    gallery.className = "record-attachments";
    photos.forEach((photoData, index) => {
        const image = document.createElement("img");
        image.className = "record-attachment";
        image.src = photoData;
        image.alt = `${altText}, фото ${index + 1}`;
        gallery.appendChild(image);
    });
    container.appendChild(gallery);
}

function renderAttachmentPreview(containerId, photos, altText, onRemove) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.replaceChildren();
    if (!Array.isArray(photos)) return;

    photos.forEach((photoData, index) => {
        if (typeof photoData !== "string" || !photoData.startsWith("data:image/")) return;

        const item = document.createElement("div");
        item.className = "photo-preview-item";

        const image = document.createElement("img");
        image.src = photoData;
        image.alt = `${altText}, фото ${index + 1}`;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "attachment-remove-button";
        removeButton.textContent = "Убрать";
        removeButton.addEventListener("click", () => onRemove(index));

        item.append(image, removeButton);
        container.appendChild(item);
    });
}

async function handleAttachmentPhotoSelection(event, section, token) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.target.value = "";

    const validFiles = files.filter(file => file.type.startsWith("image/") && file.size <= 10 * 1024 * 1024);
    if (validFiles.length !== files.length) {
        alert("Добавлены только изображения размером до 10 МБ.");
    }
    if (!validFiles.length) {
        event.target.value = "";
        return;
    }

    try {
        const photos = await Promise.all(validFiles.map(compressPetPhoto));
        if (token !== photoSelectionTokens[section]) return;
        if (section === "health") {
            pendingHealthPhotos.push(...photos);
            renderAttachmentPreview("recordPhotoPreview", pendingHealthPhotos, "Фото к записи о здоровье", removeHealthPhoto);
        } else if (section === "reminder") {
            pendingReminderPhotos.push(...photos);
            renderAttachmentPreview("reminderPhotoPreview", pendingReminderPhotos, "Фото к напоминанию", removeReminderPhoto);
        }
    } catch (error) {
        console.error("Ошибка обработки вложенного фото:", error);
        alert("Не удалось подготовить фотографии. Попробуйте выбрать другие файлы.");
    }
}

function queueAttachmentPhotoSelection(event, section) {
    const token = photoSelectionTokens[section];
    const task = handleAttachmentPhotoSelection(event, section, token);
    photoSelectionTasks[section] = Promise.all([photoSelectionTasks[section], task]).then(() => {});
}

async function waitForPhotoSelection(section) {
    let task;
    do {
        task = photoSelectionTasks[section];
        await task;
    } while (task !== photoSelectionTasks[section]);
}

function removeHealthPhoto(index) {
    pendingHealthPhotos.splice(index, 1);
    renderAttachmentPreview("recordPhotoPreview", pendingHealthPhotos, "Фото к записи о здоровье", removeHealthPhoto);
}

function clearHealthPhotos() {
    photoSelectionTokens.health += 1;
    photoSelectionTasks.health = Promise.resolve();
    pendingHealthPhotos = [];
    const input = document.getElementById("recordPhotoInput");
    if (input) input.value = "";
    renderAttachmentPreview("recordPhotoPreview", pendingHealthPhotos, "Фото к записи о здоровье", removeHealthPhoto);
}

function removeReminderPhoto(index) {
    pendingReminderPhotos.splice(index, 1);
    renderAttachmentPreview("reminderPhotoPreview", pendingReminderPhotos, "Фото к напоминанию", removeReminderPhoto);
}

function clearReminderPhotos() {
    photoSelectionTokens.reminder += 1;
    photoSelectionTasks.reminder = Promise.resolve();
    pendingReminderPhotos = [];
    const input = document.getElementById("reminderPhotoInput");
    if (input) input.value = "";
    renderAttachmentPreview("reminderPhotoPreview", pendingReminderPhotos, "Фото к напоминанию", removeReminderPhoto);
}


async function handlePetPhotoSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
        alert("Выберите файл изображения.");
        event.target.value = "";
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert("Размер исходного фото должен быть не больше 10 МБ.");
        event.target.value = "";
        return;
    }

    try {
        pendingPetPhoto = await compressPetPhoto(file);
        renderPetAvatar(document.getElementById("petPhotoPreview"), {
            name: document.getElementById("nameInput")?.value.trim(),
            photoData: pendingPetPhoto
        });
    } catch (error) {
        console.error("Ошибка обработки фото питомца:", error);
        alert("Не удалось подготовить фотографию. Попробуйте выбрать другой файл.");
        event.target.value = "";
    }
}


function removePetPhoto() {
    pendingPetPhoto = null;
    const photoInput = document.getElementById("petPhotoInput");
    if (photoInput) photoInput.value = "";
    renderPetAvatar(document.getElementById("petPhotoPreview"), {
        animal: document.getElementById("animalInput")?.value || "🐶"
    });
}

function openPetForm(createNew = false, returnPage = "petPage") {
    petFormMode = createNew ? "create" : "edit";
    petFormReturnPage = returnPage;
    hideAllPages();
    markActiveNavigation(returnPage === "healthPage" ? "nav-health" : "nav-pet");

    const petForm = document.getElementById("petForm");

    if (petForm) {
        petForm.style.display = "block";
    }

    fillPetForm();
}


function closePetForm() {
    if (petFormReturnPage === "healthPage") showHealth();
    else if (petFormReturnPage === "remindersPage") showReminders();
    else showPet();
}


function fillPetForm() {
    const nameInput = document.getElementById("nameInput");
    const breedInput = document.getElementById("breedInput");
    const weightInput = document.getElementById("weightInput");
    const birthDateInput = document.getElementById("birthDateInput");
    const allergiesInput = document.getElementById("allergiesInput");
    const medicationsInput = document.getElementById("medicationsInput");
    const vetClinicInput = document.getElementById("vetClinicInput");
    const vetPhoneInput = document.getElementById("vetPhoneInput");
    const animalInput = document.getElementById("animalInput");
    const formTitle = document.getElementById("petFormTitle");
    const saveButton = document.getElementById("savePetButton");
    const photoInput = document.getElementById("petPhotoInput");
    const formPet = petFormMode === "create" ? null : appData.pet;

    pendingPetPhoto = undefined;
    if (photoInput) photoInput.value = "";
    if (formTitle) formTitle.textContent = petFormMode === "create" ? "Новый питомец" : "Данные питомца";
    if (saveButton) saveButton.textContent = petFormMode === "create" ? "💾 Добавить питомца" : "💾 Сохранить";

    if (nameInput) {
        nameInput.value = formPet?.name || "";
    }

    if (breedInput) {
        breedInput.value = formPet?.breed || "";
    }

    if (weightInput) {
        weightInput.value = formPet?.weight || "";
    }

    if (birthDateInput) birthDateInput.value = formPet?.birthDate || "";
    if (allergiesInput) allergiesInput.value = formPet?.allergies || "";
    if (medicationsInput) medicationsInput.value = formPet?.medications || "";
    if (vetClinicInput) vetClinicInput.value = formPet?.vetClinic || "";
    if (vetPhoneInput) vetPhoneInput.value = formPet?.vetPhone || "";

    if (animalInput) {
        animalInput.value = formPet?.animal || "🐶";
    }

    renderPetAvatar(document.getElementById("petPhotoPreview"), formPet || { animal: animalInput?.value || "🐶" });
    window.PetCareExperience?.previewPet(formPet || { animal: animalInput?.value || "🐶" });
}


// ==============================
// СОХРАНЕНИЕ ПИТОМЦА
// ==============================

async function savePet() {
    const nameInput = document.getElementById("nameInput");
    const breedInput = document.getElementById("breedInput");
    const weightInput = document.getElementById("weightInput");
    const birthDateInput = document.getElementById("birthDateInput");
    const allergiesInput = document.getElementById("allergiesInput");
    const medicationsInput = document.getElementById("medicationsInput");
    const vetClinicInput = document.getElementById("vetClinicInput");
    const vetPhoneInput = document.getElementById("vetPhoneInput");
    const animalInput = document.getElementById("animalInput");

    const isCreating = petFormMode === "create";
    const previousPet = isCreating ? null : appData.pet;
    const name = nameInput ? nameInput.value.trim() : "";
    const breed = breedInput ? breedInput.value.trim() : "";
    const weight = weightInput ? weightInput.value : "";
    const animal = animalInput ? animalInput.value : "🐶";

    if (!name) {
        alert("Введите имя питомца!");
        return;
    }

    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !userData.user || userData.user.id !== activeUserId) {
        alert("Сначала войдите в аккаунт!");
        return;
    }

    const pet = {
        ...(previousPet || {}),
        id: previousPet ? getPetKey(previousPet) : `pet-${Date.now()}`,
        name,
        breed,
        weight: weight ? Number(weight) : null,
        animal,
        birthDate: birthDateInput?.value || "",
        allergies: allergiesInput?.value.trim() || "",
        medications: medicationsInput?.value.trim() || "",
        vetClinic: vetClinicInput?.value.trim() || "",
        vetPhone: vetPhoneInput?.value.trim() || "",
        photoData: pendingPetPhoto === undefined ? (previousPet?.photoData || null) : pendingPetPhoto,
        dbId: previousPet?.dbId || null,
        isPlaceholder: false,
        weightHistory: Array.isArray(previousPet?.weightHistory) ? [...previousPet.weightHistory] : []
    };
    if (!pet.weightHistory.length && Number(previousPet?.weight) > 0) {
        pet.weightHistory.push({ id: `initial-${getPetKey(previousPet)}`, date: getLocalDateInputValue(), value: Number(previousPet.weight) });
    }
    if (Number(weight) > 0 && Number(weight) !== Number(previousPet?.weight)) {
        pet.weightHistory.push({ id: `weight-${Date.now()}`, date: getLocalDateInputValue(), value: Number(weight) });
    }
    const databasePet = {
        name,
        breed,
        weight: weight ? Number(weight) : null,
        animal,
        user_id: userData.user.id
    };
    let databaseWarning = null;

    try {
        const result = pet.dbId
            ? await supabaseClient
                .from("pets")
                .update(databasePet)
                .eq("id", pet.dbId)
                .eq("user_id", userData.user.id)
                .select()
                .maybeSingle()
            : await supabaseClient
                .from("pets")
                .insert(databasePet)
                .select()
                .maybeSingle();

        if (result.error) {
            databaseWarning = result.error;
        } else if (result.data?.id) {
            pet.dbId = result.data.id;
            pet.id = String(result.data.id);
        }
    } catch (error) {
        databaseWarning = error;
    }

    if (databaseWarning) {
        console.warn("Не удалось обновить отдельную запись в таблице pets; профиль сохранится в данных PetCare:", databaseWarning);
    }

    const previousKey = previousPet ? getPetKey(previousPet) : null;
    const newPetKey = getPetKey(pet);
    if (!isCreating && previousKey !== newPetKey) {
        appData.healthRecords = appData.healthRecords.map(record =>
            String(record.petId) === previousKey ? { ...record, petId: newPetKey } : record
        );
        appData.reminders = appData.reminders.map(reminder =>
            String(reminder.petId) === previousKey ? { ...reminder, petId: newPetKey } : reminder
        );
    }

    if (isCreating) {
        appData.pets.push(pet);
    } else {
        const petIndex = appData.pets.findIndex(existing => getPetKey(existing) === previousKey);
        if (petIndex >= 0) appData.pets[petIndex] = pet;
        else appData.pets.push(pet);
    }

    appData.pet = pet;
    appData.activePetId = getPetKey(pet);
    normalizeAppData();
    await saveData();
    updatePetOnScreen();
    closePetForm();

    alert(databaseWarning
        ? "Профиль питомца сохранён. Данные останутся в аккаунте PetCare."
        : "Питомец сохранён! 🐾");
}


async function deletePet() {
    const pet = appData.pet;
    if (!pet || pet.isPlaceholder) {
        alert("Сначала добавьте питомца в профиль.");
        return;
    }

    const petName = pet.name || "этого питомца";
    const confirmed = window.confirm(
        `Удалить ${petName}? Вместе с карточкой будут удалены его записи о здоровье, напоминания и история. Это действие нельзя отменить.`
    );
    if (!confirmed) return;

    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !userData.user || userData.user.id !== activeUserId) {
        alert("Сначала войдите в аккаунт.");
        return;
    }

    if (pet.dbId != null) {
        const { error } = await supabaseClient
            .from("pets")
            .delete()
            .eq("id", pet.dbId)
            .eq("user_id", userData.user.id);

        if (error) {
            console.error("Не удалось удалить питомца из Supabase:", error);
            alert("Не удалось удалить питомца. Проверьте подключение и попробуйте ещё раз.");
            return;
        }
    }

    const deletedPetId = getPetKey(pet);
    const remainingPets = appData.pets.filter(item => getPetKey(item) !== deletedPetId);
    appData.healthRecords = appData.healthRecords.filter(record => String(record.petId ?? deletedPetId) !== deletedPetId);
    appData.reminders = appData.reminders.filter(reminder => String(reminder.petId ?? deletedPetId) !== deletedPetId);
    appData.completedTasks = appData.completedTasks.filter(task => String(task.petId) !== deletedPetId);
    appData.activityHistory = appData.activityHistory.filter(event => String(event.petId) !== deletedPetId);
    const removedStories = appData.storyProjects.filter(story => String(story.petId) === deletedPetId);
    const removedStoryPaths = removedStories.flatMap(story => [
        story.videoPath, story.collagePath,
        ...(Array.isArray(story.photos) ? story.photos.map(photo => photo.path) : [])
    ]).filter(Boolean);
    appData.storyProjects = appData.storyProjects.filter(story => String(story.petId) !== deletedPetId);

    const nextPet = remainingPets[0] || {
        id: `empty-${Date.now()}`,
        name: "",
        breed: "",
        weight: null,
        animal: "🐾",
        dbId: null,
        isPlaceholder: true,
        weightHistory: []
    };
    appData.pets = remainingPets.length ? remainingPets : [nextPet];
    appData.pet = nextPet;
    appData.activePetId = getPetKey(nextPet);
    normalizeAppData();
    if (removedStoryPaths.length) {
        const { error: storageError } = await supabaseClient.storage
            .from(STORY_STORAGE_BUCKET)
            .remove(removedStoryPaths);
        if (storageError) console.warn("Не удалось удалить часть файлов истории питомца из хранилища:", storageError);
        removedStoryPaths.forEach(path => {
            storyMediaUrlCache.delete(path);
            storyCollageBlobCache.delete(path);
        });
    }
    let synced = await saveData();
    if (!synced) synced = await saveData();
    updatePetOnScreen();
    renderHealthRecords();
    renderReminders();
    renderHomeReminders();
    renderCalendar();
    renderStories();

    if (!synced) {
        alert("Питомец удалён на этом устройстве, но не удалось сохранить изменения в облаке. Проверьте интернет и повторите действие позже.");
    } else {
        alert(remainingPets.length
            ? `${petName} удалён из профиля.`
            : `${petName} удалён. Добавьте питомца, чтобы продолжить работу с карточкой.`);
    }
}


// ==============================
// ОБНОВЛЕНИЕ ПИТОМЦА НА ЭКРАНЕ
// ==============================

function updatePetOnScreen() {
    const pet = appData.pet || {};
    window.PetCareExperience?.updatePet(pet);
    updateHomeOverview();

    const name = pet.name || (pet.isPlaceholder ? "Добавьте питомца" : "Барни");
    const breed = pet.breed || (pet.isPlaceholder ? "Создайте карточку, чтобы начать" : "Порода не указана");
    const weight = pet.weight;

    const nameElement = document.getElementById("petName");
    const breedElement = document.getElementById("petBreed");
    const weightElement = document.getElementById("petWeight");
    const photoElement = document.getElementById("petPhoto");

    if (nameElement) nameElement.textContent = name;
    if (breedElement) breedElement.textContent = breed;

    if (weightElement) {
        weightElement.textContent = weight ? weight + " кг" : "Не указан";
    }

    renderPetAvatar(photoElement, pet);

    const homeName = document.getElementById("homePetName");
    const homeBreed = document.getElementById("homePetBreed");
    const homePhoto = document.getElementById("homePetPhoto");

    if (homeName) homeName.textContent = name;
    if (homeBreed) homeBreed.textContent = breed;
    renderPetAvatar(homePhoto, pet);

    const healthName = document.getElementById("healthPetName");

    if (healthName) {
        healthName.textContent = name;
    }

    const healthFields = {
        healthAllergies: pet.allergies || "Не указаны",
        healthMedications: pet.medications || "Не указаны",
        healthVetClinic: pet.vetClinic || "Не указана",
        healthVetPhone: pet.vetPhone || "Не указан"
    };
    Object.entries(healthFields).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
    const ageElement = document.getElementById("petAge");
    if (ageElement) ageElement.textContent = formatPetAge(pet.birthDate);

    renderPetSwitcher();
    renderWeightHistory();
    renderEventHistory();
    renderCalendar();
}

function updateHomeOverview() {
    const petId = getActivePetKey();
    const belongs = row => String(row.petId ?? petId) === petId;
    window.PetCareExperience?.updateSummary({
        health: (appData.healthRecords || []).filter(belongs).length,
        reminders: (appData.reminders || []).filter(belongs).filter(row => !isReminderCompleted(row)).length,
        photos: (appData.storyProjects || []).filter(belongs).reduce((sum, story) => sum + (story.photos || []).length, 0)
    });
}

function formatPetAge(birthDate) {
    if (!birthDate) return "Возраст не указан";
    const birth = parseReminderDate(birthDate);
    if (!birth || birth > new Date()) return "Возраст не указан";
    const today = new Date();
    let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth();
    if (today.getDate() < birth.getDate()) months -= 1;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    if (years === 0) return `${Math.max(0, remainingMonths)} мес.`;
    if (remainingMonths === 0) return `${years} ${years === 1 ? "год" : years < 5 ? "года" : "лет"}`;
    return `${years} ${years < 5 ? "года" : "лет"} ${remainingMonths} мес.`;
}


function renderPetSwitcher() {
    document.querySelectorAll(".pet-switcher-select").forEach(switcher => {
        switcher.replaceChildren();
        appData.pets.forEach(pet => {
            const option = document.createElement("option");
            option.value = getPetKey(pet);
            option.textContent = pet.name || "Питомец без имени";
            switcher.appendChild(option);
        });
        switcher.value = getActivePetKey();
    });
}


async function switchPet(petId) {
    const selectedPet = appData.pets.find(pet => getPetKey(pet) === String(petId));
    if (!selectedPet) return;
    cancelAssistantRequest();

    appData.pet = selectedPet;
    appData.activePetId = getPetKey(selectedPet);
    normalizeAppData();
    updatePetOnScreen();
    renderHealthRecords();
    renderReminders();
    renderWeightHistory();
    renderEventHistory();
    renderCalendar();
    renderHomeReminders();
    renderStories();
    if (document.getElementById("assistantPage")?.style.display === "block") {
        renderAssistantConversation();
        updateAssistantProfileStatus();
    }
    await saveData();
    startAssistantProfileLive();
}


// ==============================
// ЗАГРУЗКА ПИТОМЦА ИЗ SUPABASE
// ==============================

async function loadPetFromDatabase(expectedUserId = activeUserId) {
    try {
        const { data: userData, error: userError } =
            await supabaseClient.auth.getUser();

        if (userError || !userData.user || userData.user.id !== expectedUserId || activeUserId !== expectedUserId) {
            console.error("Пользователь не авторизован.");
            return;
        }

        const result = await supabaseClient
            .from("pets")
            .select("*")
            .eq("user_id", userData.user.id)
            .order("id", { ascending: false });

        if (activeUserId !== expectedUserId) return;

        if (result.error) {
            console.error("Ошибка загрузки питомца:", result.error);
            return;
        }

        const databasePets = Array.isArray(result.data) ? result.data : [];
        if (!databasePets.length) return;

        const savedPetsById = new Map(appData.pets
            .filter(pet => pet.dbId != null)
            .map(pet => [String(pet.dbId), pet]));
        const isDefaultPlaceholder = pet => getPetKey(pet) === "legacy-default"
            && pet.name === "Барни"
            && pet.breed === "Золотистый ретривер"
            && String(pet.weight) === "28"
            && !pet.photoData;
        const loadedPets = databasePets.map(row => {
            const savedPet = savedPetsById.get(String(row.id)) || {};
            return {
                ...savedPet,
                id: String(row.id),
                dbId: row.id,
                name: row.name || savedPet.name || "Барни",
                breed: row.breed ?? savedPet.breed ?? "",
                weight: Array.isArray(savedPet.weightHistory)
                    ? (savedPet.weight ?? null)
                    : (row.weight ?? savedPet.weight ?? ""),
                animal: row.animal || savedPet.animal || "🐶",
                photoData: savedPet.photoData || null
            };
        });
        const databaseIds = new Set(loadedPets.map(pet => String(pet.dbId)));
        const localOnlyPets = appData.pets.filter(pet => {
            return pet.dbId == null && !databaseIds.has(getPetKey(pet)) && !isDefaultPlaceholder(pet);
        });
        appData.pets = [...loadedPets, ...localOnlyPets];

        const selectedPet = appData.pets.find(pet => getPetKey(pet) === String(appData.activePetId))
            || loadedPets[0]
            || appData.pets[0];
        const defaultPlaceholderWasRemoved = appData.pets.every(pet => !isDefaultPlaceholder(pet));
        if (defaultPlaceholderWasRemoved) {
            appData.healthRecords = appData.healthRecords.map(record =>
                String(record.petId) === "legacy-default"
                    ? { ...record, petId: getPetKey(selectedPet) }
                    : record
            );
            appData.reminders = appData.reminders.map(reminder =>
                String(reminder.petId) === "legacy-default"
                    ? { ...reminder, petId: getPetKey(selectedPet) }
                    : reminder
            );
        }
        appData.activePetId = getPetKey(selectedPet);
        appData.pet = selectedPet;
        normalizeAppData();
        await saveData();
        updatePetOnScreen();
    } catch (error) {
        console.error("Ошибка загрузки питомца:", error);
    }
}

 

// ==============================
// ЗДОРОВЬЕ — ФОРМА
// ==============================

function openHealthForm() {
    clearHealthPhotos();

    const dateInput = document.getElementById("recordDate");
    const nextDateInput = document.getElementById("recordNextDate");
    const nameInput = document.getElementById("recordName");
    const noteInput = document.getElementById("recordNote");
    if (dateInput) dateInput.value = getLocalDateInputValue();
    if (nextDateInput) nextDateInput.value = "";
    if (nameInput) nameInput.value = "";
    if (noteInput) noteInput.value = "";

    hideAllPages();
    markActiveNavigation("nav-health");

    const healthForm = document.getElementById("healthForm");

    if (healthForm) {
        healthForm.style.display = "block";
    }
}

function closeHealthForm() {
    showHealth();
}


// ==============================
// СОХРАНЕНИЕ ЗАПИСИ ЗДОРОВЬЯ
// ==============================

async function saveHealthRecord() {
    await waitForPhotoSelection("health");

    const type = document.getElementById("recordType").value;
    const name = document.getElementById("recordName").value.trim();
    const date = document.getElementById("recordDate").value;
    const nextDate = document.getElementById("recordNextDate")?.value || "";
    const note = document.getElementById("recordNote").value.trim();

    if (name === "") {
        alert("Введите название записи!");
        return;
    }

    const record = {
        id: Date.now(),
        type: type,
        name: name,
        date: date,
        nextDate,
        note: note,
        photos: [...pendingHealthPhotos],
        petId: getActivePetKey()
    };

    appData.healthRecords.push(record);
    if (nextDate) {
        appData.reminders.push({
            id: `health-followup-${record.id}`,
            type: type === "Лекарство" ? "Лекарство" : type === "Ветеринар" ? "Ветеринар" : "Уход",
            name: `Повтор: ${name}`,
            date: nextDate,
            time: "",
            repeat: "once",
            photos: [],
            petId: getActivePetKey(),
            sourceRecordId: String(record.id)
        });
    }

    await saveData();
    renderHealthRecords();
    renderReminders();
    renderHomeReminders();
    renderCalendar();
    clearHealthPhotos();
    closeHealthForm();
}


// ==============================
// ДОБАВИТЬ ЗАПИСЬ ЗДОРОВЬЯ
// ==============================

function addHealthRecordToScreen(record) {
    const container = document.getElementById("healthRecords");

    if (!container) {
        return;
    }

    const recordElement = document.createElement("div");
    recordElement.className = "health-record";

    let icon = "❤️";

    if (record.type === "Прививка") {
        icon = "💉";
    }

    if (record.type === "Лекарство") {
        icon = "💊";
    }

    if (record.type === "Ветеринар") {
        icon = "🩺";
    }

    const iconElement = document.createElement("div");
    iconElement.className = "record-icon";
    iconElement.textContent = icon;

    const info = document.createElement("div");
    info.className = "record-info";
    const title = document.createElement("strong");
    title.textContent = record.name;
    const date = document.createElement("small");
    date.textContent = record.date ? formatHistoryDate(record.date) : "Дата не указана";
    info.append(title, date);
    if (record.nextDate) {
        const followUp = document.createElement("small");
        followUp.className = "follow-up-date";
        followUp.textContent = `Следующая процедура: ${formatHistoryDate(record.nextDate)}`;
        info.appendChild(followUp);
    }
    if (record.note) {
        const note = document.createElement("small");
        note.textContent = record.note;
        info.appendChild(note);
    }
    appendAttachmentPhotos(info, record, `Фото к записи «${record.name}»`);
    recordElement.append(iconElement, info, createEntryDeleteButton(
        "health-delete", record.id, record.petId ?? getActivePetKey(), `Удалить запись «${record.name}»`
    ));

    container.appendChild(recordElement);
}


// ==============================
// ПОКАЗАТЬ ВСЕ ЗАПИСИ ЗДОРОВЬЯ
// ==============================

function renderHealthRecords() {
    renderEventHistory();
}

function formatHistoryDate(value) {
    const date = parseReminderDate(value);
    return date ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "Дата не указана";
}

function resetEntryHistoryFilters(kind = "all") {
    ["historySearch", "historyFromDate", "historyToDate"].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
    });
    const select = document.getElementById("historyTypeFilter");
    if (select) select.value = ["all", "health", "weight", "reminder", "task"].includes(kind) ? kind : "all";
    renderEventHistory();
}

function openEntryHistory(button) {
    if (!activeUserId) return;
    const allowedPages = ["homePage", "petPage", "healthPage", "remindersPage", "storiesPage", "profilePage"];
    historyReturnPageId = allowedPages.find(id => document.getElementById(id)?.style.display === "block") || "homePage";
    const navigation = { homePage: "nav-home", petPage: "nav-pet", healthPage: "nav-health", remindersPage: "nav-reminders", storiesPage: "nav-stories", profilePage: "nav-profile" };
    hideAllPages();
    markActiveNavigation(navigation[historyReturnPageId]);
    const page = document.getElementById("entryHistoryPage");
    if (!page) return;
    page.style.display = "block";
    renderPetSwitcher();
    resetEntryHistoryFilters(button?.dataset.historyType || "all");
    window.scrollTo(0, 0);
    document.getElementById("entryHistoryTitle")?.focus({ preventScroll: true });
}

function closeEntryHistory() {
    const destinations = { homePage: showHome, petPage: showPet, healthPage: showHealth, remindersPage: showReminders, storiesPage: showStories, profilePage: showProfile };
    const destination = historyReturnPageId;
    (destinations[destination] || showHome)();
    window.scrollTo(0, 0);
    document.getElementById(destination)?.querySelector('[data-pc-click="history-open"]')?.focus({ preventScroll: true });
}

function buildPetEventHistory() {
    const petId = getActivePetKey();
    const health = appData.healthRecords
        .filter(record => String(record.petId ?? petId) === petId)
        .map(record => ({
            id: `health-${record.id}`,
            entryType: "health",
            entryId: record.id,
            petId,
            kind: "health",
            date: record.date || getLocalDateInputValue(),
            title: record.name,
            note: [record.type, record.note, record.nextDate ? `Следующая процедура: ${formatHistoryDate(record.nextDate)}` : ""].filter(Boolean).join(" · "),
            icon: record.type === "Прививка" ? "💉" : record.type === "Лекарство" ? "💊" : record.type === "Ветеринар" ? "🩺" : "❤️"
        }));
    const weights = (appData.pet?.weightHistory || []).map(entry => ({
        id: `weight-${entry.id}`,
        entryType: "weight",
        entryId: entry.id,
        petId,
        kind: "weight",
        date: entry.date || getLocalDateInputValue(),
        title: `Взвешивание · ${entry.value} кг`,
        note: "Изменение веса",
        icon: "⚖️"
    }));
    const scopedReminders = appData.reminders.filter(reminder => String(reminder.petId ?? petId) === petId);
    const activities = appData.activityHistory
        .filter(event => String(event.petId ?? petId) === petId && ["reminder", "task"].includes(event.kind))
        .map(event => ({
            id: `activity-${event.id}`,
            entryType: "activity",
            entryId: event.id,
            petId,
            kind: event.kind,
            date: event.date,
            title: event.title,
            note: event.note || "",
            reminderId: event.kind === "reminder" ? scopedReminders.find(reminder => String(event.id) === `reminder-${reminder.id}-${event.date}`)?.id : null,
            icon: event.kind === "task" ? "✓" : "🔔"
        }));
    const completedReminders = scopedReminders.filter(reminder => reminder.repeat === "once" ? Boolean(reminder.completed) : Boolean(reminder.completedForDate))
        .filter(reminder => !activities.some(event => String(event.reminderId) === String(reminder.id) && event.date === (reminder.completedForDate || reminder.date)))
        .map(reminder => ({
            id: `completed-reminder-${reminder.id}`, entryType: "reminder", entryId: reminder.id, reminderId: reminder.id, petId, kind: "reminder",
            date: reminder.completedForDate || reminder.date || getLocalDateInputValue(), title: `Выполнено: ${reminder.name}`,
            note: [reminder.type, reminder.time].filter(Boolean).join(" · "), icon: "✓"
        }));
    return [...health, ...weights, ...activities, ...completedReminders].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function renderEventHistory() {
    const container = document.getElementById("eventHistory");
    if (!container || document.getElementById("entryHistoryPage")?.style.display !== "block") return;
    container.replaceChildren();
    const query = (document.getElementById("historySearch")?.value || "").trim().toLocaleLowerCase("ru-RU");
    const kind = document.getElementById("historyTypeFilter")?.value || "all";
    const historyTitle = document.getElementById("entryHistoryTitle");
    if (historyTitle) historyTitle.textContent = ({ health: "История здоровья", reminder: "История напоминаний", weight: "История взвешиваний", task: "История задач" })[kind] || "История записей";
    const fromDate = document.getElementById("historyFromDate")?.value || "";
    const toDate = document.getElementById("historyToDate")?.value || "";
    const allEvents = buildPetEventHistory();
    const events = allEvents.filter(event => {
        const matchesKind = kind === "all" || event.kind === kind;
        const text = `${event.title} ${event.note}`.toLocaleLowerCase("ru-RU");
        const matchesDate = (!fromDate || event.date >= fromDate) && (!toDate || event.date <= toDate);
        return matchesKind && matchesDate && (!query || text.includes(query));
    });
    const resultCount = document.getElementById("historyResultCount");
    if (resultCount) resultCount.textContent = `Найдено: ${events.length} · Всего записей: ${allEvents.length}`;
    if (!events.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = allEvents.length ? "По этим фильтрам ничего не найдено. Попробуйте изменить тип или период." : "Здесь появятся записи о здоровье, взвешивания и выполненные дела питомца.";
        container.appendChild(empty);
        return;
    }
    events.forEach(event => {
        const card = document.createElement("article");
        card.className = "history-event";
        const icon = document.createElement("span");
        icon.className = "history-event-icon";
        icon.textContent = event.icon;
        const content = document.createElement("div");
        content.className = "history-event-content";
        const title = document.createElement("strong");
        title.textContent = event.title;
        const meta = document.createElement("small");
        meta.textContent = [formatHistoryDate(event.date), event.note].filter(Boolean).join(" · ");
        content.append(title, meta);
        if (event.kind === "health") {
            const record = appData.healthRecords.find(item => String(item.id) === String(event.entryId) && String(item.petId ?? event.petId) === event.petId);
            if (record) appendAttachmentPhotos(content, record, `Фото к записи «${record.name}»`);
        }
        const reminder = event.reminderId == null ? null : appData.reminders.find(item => String(item.id) === String(event.reminderId) && String(item.petId ?? event.petId) === event.petId);
        if (reminder) appendAttachmentPhotos(content, reminder, `Фото к напоминанию «${reminder.name}»`);
        card.append(icon, content);
        if (reminder && isReminderCompleted(reminder) && event.date === (reminder.completedForDate || reminder.date)) {
            card.appendChild(createReminderActions(reminder, true));
        } else card.appendChild(createEntryDeleteButton(
            `${event.entryType}-delete`, event.entryId, event.petId, `Удалить: ${event.title}`
        ));
        container.appendChild(card);
    });
}

function renderWeightHistory() {
    const chart = document.getElementById("weightChart");
    const latest = document.getElementById("weightLatest");
    if (!chart) return;
    const entries = [...(appData.pet?.weightHistory || [])]
        .filter(entry => Number(entry.value) > 0 && entry.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    chart.replaceChildren();
    if (!entries.length) {
        chart.textContent = "Добавьте первое взвешивание, чтобы увидеть динамику.";
        if (latest) latest.textContent = "";
        return;
    }
    if (latest) latest.textContent = `${entries[entries.length - 1].value} кг`;
    if (entries.length > 1) {
        const values = entries.slice(-8);
        const minValue = Math.min(...values.map(entry => Number(entry.value)));
        const maxValue = Math.max(...values.map(entry => Number(entry.value)));
        const spread = maxValue - minValue || 1;
        const points = values.map((entry, index) => {
            const x = values.length === 1 ? 50 : 6 + index * 88 / (values.length - 1);
            const y = 66 - ((Number(entry.value) - minValue) / spread) * 48;
            return `${x},${y}`;
        }).join(" ");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 100 76");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "График истории веса");
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("points", points);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", "#37835b");
        line.setAttribute("stroke-width", "2.8");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("stroke-linejoin", "round");
        svg.appendChild(line);
        values.forEach((entry, index) => {
            const [x, y] = points.split(" ")[index].split(",");
            const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot.setAttribute("cx", x);
            dot.setAttribute("cy", y);
            dot.setAttribute("r", "2.6");
            dot.setAttribute("fill", "#37835b");
            svg.appendChild(dot);
        });
        chart.appendChild(svg);
    } else {
        chart.textContent = "Добавьте ещё одно взвешивание, чтобы увидеть динамику.";
    }
}

async function savePetWeight() {
    const valueInput = document.getElementById("weightLogValue");
    const dateInput = document.getElementById("weightLogDate");
    const value = Number(valueInput?.value);
    const date = dateInput?.value || getLocalDateInputValue();
    if (!(value > 0)) {
        alert("Укажите вес больше нуля.");
        return;
    }
    const entry = { id: `weight-${Date.now()}`, date, value };
    appData.pet.weight = value;
    appData.pet.weightHistory = [...(appData.pet.weightHistory || []), entry];
    addActivityEvent("weight", `Взвешивание · ${value} кг`, date, "Изменение веса", `weight-${entry.id}`);
    if (appData.pet.dbId && activeUserId) {
        try {
            const { error } = await supabaseClient
                .from("pets")
                .update({ weight: value })
                .eq("id", appData.pet.dbId)
                .eq("user_id", activeUserId);
            if (error) console.warn("Не удалось обновить вес в таблице питомцев:", error);
        } catch (error) {
            console.warn("Вес будет сохранён в данных аккаунта PetCare:", error);
        }
    }
    await saveData();
    if (valueInput) valueInput.value = "";
    updatePetOnScreen();
}

function addActivityEvent(kind, title, date = getLocalDateInputValue(), note = "", id = `event-${Date.now()}`) {
    if (!appData.activityHistory.some(event => String(event.id) === String(id))) {
        appData.activityHistory.push({ id: String(id), kind, title, date, note, petId: getActivePetKey() });
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

function createHealthExportOption(value, title, detail, name) {
    const label = document.createElement("label");
    label.className = "health-export-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.value = String(value);
    input.dataset.pcChange = "health-export-selection";
    const text = document.createElement("span");
    const heading = document.createElement("strong");
    heading.textContent = title;
    text.appendChild(heading);
    if (detail) {
        const description = document.createElement("small");
        description.textContent = detail;
        text.appendChild(description);
    }
    label.append(input, text);
    return label;
}

function openHealthExportDialog() {
    const dialog = document.getElementById("healthExportDialog");
    if (!dialog) return;
    if (!activeUserId || !appData.pet || appData.pet.isPlaceholder) {
        alert("Войдите в аккаунт и выберите питомца для экспорта.");
        return;
    }
    const petId = getActivePetKey();
    dialog.dataset.userId = activeUserId;
    dialog.dataset.petId = petId;
    document.getElementById("healthExportPetName").textContent = `Питомец: ${appData.pet.name || "Без имени"}. Отметьте только то, что нужно напечатать.`;
    dialog.querySelectorAll('[name="healthExportField"]').forEach(input => {
        input.checked = input.value === "basic";
    });

    const records = appData.healthRecords
        .filter(record => String(record.petId ?? petId) === petId)
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const weights = [...(appData.pet.weightHistory || [])]
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const groups = [
        ["healthExportRecords", records, "healthExportRecord", record => [record.name || "Без названия", [record.type, formatHistoryDate(record.date)].filter(Boolean).join(" · ")], "Медицинских записей пока нет."],
        ["healthExportWeights", weights, "healthExportWeight", entry => [`${entry.value} кг`, formatHistoryDate(entry.date)], "Взвешиваний пока нет."]
    ];
    groups.forEach(([id, entries, name, describe, emptyText]) => {
        const container = document.getElementById(id);
        container.replaceChildren();
        entries.forEach(entry => {
            const [title, detail] = describe(entry);
            container.appendChild(createHealthExportOption(entry.id, title, detail, name));
        });
        if (!entries.length) {
            const empty = document.createElement("p");
            empty.className = "health-export-empty";
            empty.textContent = emptyText;
            container.appendChild(empty);
        }
        dialog.querySelectorAll(`[data-export-group="${id}"]`).forEach(button => {
            button.disabled = entries.length === 0;
        });
    });
    updateHealthExportSelection();
    if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
    }
}

function closeHealthExportDialog() {
    const dialog = document.getElementById("healthExportDialog");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
}

function updateHealthExportSelection() {
    const dialog = document.getElementById("healthExportDialog");
    if (!dialog) return;
    const count = dialog.querySelectorAll('input[type="checkbox"]:checked').length;
    document.getElementById("healthExportPrintButton").disabled = count === 0;
    document.getElementById("healthExportSelectionStatus").textContent = count
        ? `Выбрано пунктов: ${count}`
        : "Выберите хотя бы один пункт для печати.";
}

function setHealthExportGroup(groupId, checked) {
    if (!["healthExportRecords", "healthExportWeights"].includes(groupId)) return;
    document.getElementById(groupId)?.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.checked = checked;
    });
    updateHealthExportSelection();
}

function buildPetHealthPrintHtml(pet, fields, records, weights) {
    const cards = [];
    const addCard = (label, value) => cards.push(`<div class="card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`);
    if (fields.has("basic")) {
        addCard("Вид и порода", [pet.animal, pet.breed].filter(Boolean).join(" · ") || "Не указаны");
        addCard("Возраст и текущий вес", `${formatPetAge(pet.birthDate)} · ${pet.weight ? `${pet.weight} кг` : "Вес не указан"}`);
    }
    if (fields.has("allergies")) addCard("Аллергии", pet.allergies || "Не указаны");
    if (fields.has("medications")) addCard("Постоянные лекарства", pet.medications || "Не указаны");
    if (fields.has("vet")) addCard("Ветеринарная клиника и телефон", [pet.vetClinic, pet.vetPhone].filter(Boolean).join(" · ") || "Не указаны");
    const recordRows = records.map(record => `
        <article class="entry"><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(record.type)} · ${escapeHtml(formatHistoryDate(record.date))}</small>
        ${record.nextDate ? `<small>Следующая процедура: ${escapeHtml(formatHistoryDate(record.nextDate))}</small>` : ""}
        ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}</article>`).join("");
    const weightRows = weights.map(entry => `<li>${escapeHtml(formatHistoryDate(entry.date))} — <strong>${escapeHtml(entry.value)} кг</strong></li>`).join("");
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Здоровье — ${escapeHtml(pet.name || "Питомец")}</title>
        <style>
            @page{size:A4;margin:16mm}
            *{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#24382a;max-width:760px;margin:32px auto;padding:0 20px;line-height:1.5;overflow-wrap:anywhere}
            h1,h2{color:#216044}h1{font-size:24px;margin-bottom:4px}h2{font-size:18px;break-after:avoid}.subtitle{color:#728277;margin-top:0}
            .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:22px 0}
            .card,.entry{border:1px solid #dce9df;border-radius:10px;padding:12px;break-inside:avoid}.entry{margin:10px 0}
            .card small,.entry small{display:block;color:#6c7f70;margin:4px 0}.card strong,.entry p{display:block;white-space:pre-wrap}
            ul{padding-left:20px}li{margin:6px 0;break-inside:avoid}.section{margin-top:24px}
            @media print{body{max-width:none;margin:0;padding:0}}
        </style></head><body>
        <h1>Здоровье питомца · ${escapeHtml(pet.name || "Без имени")}</h1>
        <p class="subtitle">PetCare · Сформировано ${escapeHtml(new Date().toLocaleDateString("ru-RU"))}</p>
        ${cards.length ? `<div class="grid">${cards.join("")}</div>` : ""}
        ${records.length ? `<section class="section"><h2>Медицинские записи</h2>${recordRows}</section>` : ""}
        ${weights.length ? `<section class="section"><h2>История веса</h2><ul>${weightRows}</ul></section>` : ""}
        </body></html>`;
}

function exportPetHealthPdf() {
    const dialog = document.getElementById("healthExportDialog");
    if (!dialog?.open) return;
    if (!activeUserId || dialog.dataset.userId !== activeUserId || dialog.dataset.petId !== getActivePetKey()) {
        closeHealthExportDialog();
        alert("Питомец или аккаунт изменился. Откройте выбор данных для PDF ещё раз.");
        return;
    }
    const selectedValues = name => new Set([...dialog.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value));
    const fields = selectedValues("healthExportField");
    const recordIds = selectedValues("healthExportRecord");
    const weightIds = selectedValues("healthExportWeight");
    const petId = getActivePetKey();
    const records = appData.healthRecords.filter(record =>
        String(record.petId ?? petId) === petId && recordIds.has(String(record.id))
    ).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const weights = (appData.pet.weightHistory || []).filter(entry => weightIds.has(String(entry.id)))
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!fields.size && !records.length && !weights.length) {
        alert("Выберите хотя бы один пункт для печати.");
        updateHealthExportSelection();
        return;
    }
    const html = buildPetHealthPrintHtml(appData.pet, fields, records, weights);
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        alert("Разрешите открытие нового окна, чтобы распечатать выбранные данные или сохранить PDF.");
        return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    closeHealthExportDialog();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 300);
}


// ==============================
// НАПОМИНАНИЯ — ФОРМА
// ==============================

function openReminderForm() {
    clearReminderPhotos();

    hideAllPages();
    markActiveNavigation("nav-reminders");

    const reminderForm = document.getElementById("reminderForm");
    const dateInput = document.getElementById("reminderDate");
    const repeatInput = document.getElementById("reminderRepeat");
    const nameInput = document.getElementById("reminderName");
    const timeInput = document.getElementById("reminderTime");
    if (dateInput) dateInput.value = getLocalDateInputValue();
    if (nameInput) nameInput.value = "";
    if (timeInput) timeInput.value = "";
    if (repeatInput) repeatInput.value = "once";

    if (reminderForm) {
        reminderForm.style.display = "block";
    }
}

function closeReminderForm() {
    showReminders();
}


// ==============================
// СОХРАНЕНИЕ НАПОМИНАНИЯ
// ==============================

async function saveReminder() {
    await waitForPhotoSelection("reminder");

    const type = document.getElementById("reminderType").value;
    const name = document.getElementById("reminderName").value.trim();
    const date = document.getElementById("reminderDate").value;
    const time = document.getElementById("reminderTime").value;
    const repeat = document.getElementById("reminderRepeat").value;

    if (name === "") {
        alert("Введите название напоминания!");
        return;
    }

    const reminder = {
        id: Date.now(),
        type: type,
        name: name,
        date: date || getLocalDateInputValue(),
        time: time,
        repeat,
        photos: [...pendingReminderPhotos],
        petId: getActivePetKey()
    };

    appData.reminders.push(reminder);

    const synced = await saveData();
    renderReminders();
    renderHomeReminders();
    renderCalendar();
    clearReminderPhotos();
    closeReminderForm();
    if (!synced) alert("Напоминание сохранено на устройстве, но не синхронизировано с сервером. Push-уведомление придёт после восстановления соединения и синхронизации.");
}


// ==============================
// ДОБАВИТЬ НАПОМИНАНИЕ НА ЭКРАН
// ==============================

function isReminderCompleted(reminder) {
    if (reminder.repeat === "once") return Boolean(reminder.completed);
    const dueDate = getNextReminderDate(reminder);
    const dueDateKey = dueDate ? getLocalDateInputValue(dueDate) : getLocalDateInputValue();
    return reminder.completedForDate === dueDateKey;
}

function getReminderIcon(reminder) {
    const icons = {
        "Кормление": "🍖",
        "Прогулка": "🚶",
        "Лекарство": "💊",
        "Ветеринар": "🩺",
        "Уход": "🛁",
        "Фото питомца": "📸"
    };
    return icons[reminder.type] || "🔔";
}

function createReminderCompletionButton(reminder, completed) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reminder-complete";
    button.textContent = completed ? "✓" : "○";
    button.setAttribute("aria-pressed", String(completed));
    button.setAttribute("aria-label", completed ? "Снять отметку выполнения" : "Отметить выполненным");
    button.addEventListener("click", () => toggleReminderCompletion(reminder.id));
    return button;
}

function createReminderActions(reminder, completed) {
    const actions = document.createElement("div");
    actions.className = "entry-actions";
    actions.append(createReminderCompletionButton(reminder, completed), createEntryDeleteButton(
        "reminder-delete", reminder.id, reminder.petId ?? getActivePetKey(), `Удалить напоминание «${reminder.name}»`
    ));
    return actions;
}

function addHomeReminderToScreen(reminder) {
    const container = document.getElementById("homeRemindersList");
    if (!container) return;

    const card = document.createElement("article");
    card.className = "home-reminder";

    const icon = document.createElement("div");
    icon.className = "reminder-icon";
    icon.textContent = getReminderIcon(reminder);

    const info = document.createElement("div");
    info.className = "record-info home-reminder-info";
    const title = document.createElement("strong");
    title.textContent = reminder.name;
    const detail = document.createElement("small");
    const nextDate = getNextReminderDate(reminder);
    const repeatLabels = { daily: "Каждый день", weekly: "Каждую неделю" };
    detail.textContent = [
        nextDate ? formatReminderDate(nextDate) : "Дата не указана",
        repeatLabels[reminder.repeat],
        reminder.time
    ].filter(Boolean).join(" · ");
    info.append(title, detail);

    card.append(icon, info, createReminderActions(reminder, false));
    container.appendChild(card);
}

function renderHomeReminders() {
    const container = document.getElementById("homeRemindersList");
    if (!container) return;
    container.replaceChildren();

    const activePetId = getActivePetKey();
    const reminders = appData.reminders
        .filter(reminder => String(reminder.petId ?? activePetId) === activePetId)
        .filter(reminder => !isReminderCompleted(reminder))
        .sort((left, right) => {
            const leftDate = getNextReminderDate(left)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const rightDate = getNextReminderDate(right)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return leftDate - rightDate || String(left.time || "").localeCompare(String(right.time || ""));
        });

    if (!reminders.length) {
        const empty = document.createElement("div");
        empty.className = "home-reminders-empty";
        const message = document.createElement("p");
        message.textContent = "Нет активных напоминаний";
        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "home-reminders-add";
        addButton.textContent = "+ Добавить напоминание";
        addButton.addEventListener("click", openReminderForm);
        empty.append(message, addButton);
        container.appendChild(empty);
        return;
    }

    reminders.forEach(addHomeReminderToScreen);
}

async function toggleReminderCompletion(reminderId) {
    const reminder = appData.reminders.find(item =>
        String(item.id) === String(reminderId)
        && String(item.petId ?? getActivePetKey()) === getActivePetKey()
    );
    if (!reminder) return;

    let completedDate = null;
    let uncompletedDate = null;
    if (reminder.repeat === "once") {
        if (reminder.completed) uncompletedDate = reminder.date || getLocalDateInputValue();
        reminder.completed = !reminder.completed;
        if (reminder.completed) completedDate = reminder.date || getLocalDateInputValue();
    } else {
        const dueDate = getNextReminderDate(reminder);
        const dueDateKey = dueDate ? getLocalDateInputValue(dueDate) : getLocalDateInputValue();
        if (reminder.completedForDate === dueDateKey) uncompletedDate = dueDateKey;
        reminder.completedForDate = reminder.completedForDate === dueDateKey ? null : dueDateKey;
        if (reminder.completedForDate) completedDate = dueDateKey;
    }

    if (completedDate) {
        addActivityEvent("reminder", `Выполнено: ${reminder.name}`, completedDate, reminder.time || reminder.type || "Напоминание", `reminder-${reminder.id}-${completedDate}`);
    }
    if (uncompletedDate) {
        appData.activityHistory = appData.activityHistory.filter(event => !(String(event.petId ?? getActivePetKey()) === getActivePetKey() && String(event.id) === `reminder-${reminder.id}-${uncompletedDate}`));
    }

    await saveData();
    renderReminders();
    renderHomeReminders();
    renderEventHistory();
    renderCalendar();
}

function addReminderToScreen(reminder) {
    const container = document.getElementById("remindersList");

    if (!container) {
        return;
    }

    const reminderElement = document.createElement("div");
    reminderElement.className = "reminder";
    const completed = isReminderCompleted(reminder);
    reminderElement.classList.toggle("done", completed);

    const iconElement = document.createElement("div");
    iconElement.className = "reminder-icon";
    iconElement.textContent = getReminderIcon(reminder);

    const info = document.createElement("div");
    info.className = "record-info";
    const title = document.createElement("strong");
    title.textContent = reminder.name;
    const detail = document.createElement("small");
    const nextDate = getNextReminderDate(reminder);
    const repeatLabels = { daily: "Каждый день", weekly: "Каждую неделю" };
    const dateLabel = nextDate ? formatReminderDate(nextDate) : "Дата не указана";
    detail.textContent = [repeatLabels[reminder.repeat], dateLabel, reminder.time]
        .filter(Boolean)
        .join(" · ");
    info.append(title, detail);
    appendAttachmentPhotos(info, reminder, `Фото к напоминанию «${reminder.name}»`);

    reminderElement.append(iconElement, info, createReminderActions(reminder, completed));

    container.appendChild(reminderElement);
}


function parseReminderDate(value) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}


function getLocalDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}


function getNextReminderDate(reminder) {
    const startDate = parseReminderDate(reminder.date);
    if (!startDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    startDate.setHours(0, 0, 0, 0);

    if (reminder.repeat === "daily" && startDate < today) return today;
    if (reminder.repeat === "weekly" && startDate < today) {
        const daysSinceStart = Math.floor((today - startDate) / 86400000);
        startDate.setDate(startDate.getDate() + Math.ceil(daysSinceStart / 7) * 7);
    }
    return startDate;
}


function formatReminderDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);

    if (day.getTime() === today.getTime()) return "Сегодня";
    if (day.getTime() === tomorrow.getTime()) return "Завтра";
    return day.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function changeCalendarMonth(offset) {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + offset, 1);
    selectedCalendarDate = getLocalDateInputValue(calendarCursor);
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById("calendarGrid");
    const label = document.getElementById("calendarMonthLabel");
    const dayEvents = document.getElementById("calendarDayEvents");
    if (!grid || !label || !dayEvents) return;
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    label.textContent = calendarCursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const eventsByDate = new Map();
    const addEvent = (date, title, icon, kind) => {
        if (!date) return;
        const key = typeof date === "string" ? date : getLocalDateInputValue(date);
        if (!key.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`)) return;
        if (!eventsByDate.has(key)) eventsByDate.set(key, []);
        eventsByDate.get(key).push({ title, icon, kind });
    };
    const activeId = getActivePetKey();
    const completedReminderIds = new Set(appData.activityHistory
        .filter(event => String(event.petId ?? activeId) === activeId && event.kind === "reminder")
        .map(event => String(event.id)));
    const addPlannedReminder = (date, reminder) => {
        const key = typeof date === "string" ? date : getLocalDateInputValue(date);
        if (reminder.completedForDate === key || completedReminderIds.has(`reminder-${reminder.id}-${key}`)) return;
        addEvent(date, reminder.name, getReminderIcon(reminder), "reminder");
    };
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    appData.reminders.filter(item => String(item.petId ?? activeId) === activeId).forEach(reminder => {
        if ((reminder.repeat === "once" || !reminder.repeat) && reminder.completed) return;
        const start = parseReminderDate(reminder.date);
        if (!start) return;
        start.setHours(0, 0, 0, 0);
        if (reminder.repeat === "daily") {
            const cursor = new Date(Math.max(start.getTime(), monthStart.getTime()));
            while (cursor <= monthEnd) {
                addPlannedReminder(cursor, reminder);
                cursor.setDate(cursor.getDate() + 1);
            }
        } else if (reminder.repeat === "weekly") {
            const cursor = new Date(start);
            while (cursor < monthStart) cursor.setDate(cursor.getDate() + 7);
            while (cursor <= monthEnd) {
                addPlannedReminder(cursor, reminder);
                cursor.setDate(cursor.getDate() + 7);
            }
        } else {
            addPlannedReminder(reminder.date, reminder);
        }
    });

    grid.replaceChildren();
    const offset = (firstDay.getDay() + 6) % 7;
    for (let i = 0; i < offset; i += 1) {
        const blank = document.createElement("span");
        blank.className = "calendar-empty-day";
        grid.appendChild(blank);
    }
    const todayKey = getLocalDateInputValue();
    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const dateKey = getLocalDateInputValue(date);
        const events = eventsByDate.get(dateKey) || [];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "calendar-day";
        if (dateKey === todayKey) button.classList.add("today");
        if (dateKey === selectedCalendarDate) button.classList.add("selected");
        button.setAttribute("aria-pressed", String(dateKey === selectedCalendarDate));
        button.setAttribute("aria-label", `${day} ${calendarCursor.toLocaleDateString("ru-RU", { month: "long" })}${events.length ? `, событий: ${events.length}` : ""}`);
        button.append(document.createTextNode(String(day)));
        if (events.length) {
            const marker = document.createElement("span");
            marker.className = "calendar-marker";
            marker.setAttribute("aria-hidden", "true");
            button.appendChild(marker);
        }
        button.addEventListener("click", () => {
            selectedCalendarDate = dateKey;
            renderCalendar();
        });
        grid.appendChild(button);
    }
    const remainder = (7 - ((offset + daysInMonth) % 7)) % 7;
    for (let i = 0; i < remainder; i += 1) {
        const blank = document.createElement("span");
        blank.className = "calendar-empty-day";
        grid.appendChild(blank);
    }
    dayEvents.replaceChildren();
    const heading = document.createElement("strong");
    heading.className = "calendar-selected-date";
    heading.textContent = formatHistoryDate(selectedCalendarDate);
    dayEvents.appendChild(heading);
    const chosenEvents = eventsByDate.get(selectedCalendarDate) || [];
    if (!chosenEvents.length) {
        const empty = document.createElement("small");
        empty.textContent = "На этот день событий нет";
        dayEvents.appendChild(empty);
        return;
    }
    chosenEvents.forEach(event => {
        const row = document.createElement("div");
        row.className = "calendar-event-row";
        const icon = document.createElement("span");
        icon.textContent = event.icon;
        const title = document.createElement("span");
        title.textContent = event.title;
        row.append(icon, title);
        dayEvents.appendChild(row);
    });
}


// ==============================
// ПОКАЗАТЬ ВСЕ НАПОМИНАНИЯ
// ==============================

function renderReminders() {
    const container = document.getElementById("remindersList");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const reminders = appData.reminders.filter(reminder =>
        String(reminder.petId ?? getActivePetKey()) === getActivePetKey()
    ).filter(reminder => !isReminderCompleted(reminder));

    if (reminders.length === 0) {
        container.innerHTML = `
            <p style="text-align:center;color:#888;">
                Активных напоминаний нет. Выполненные доступны по кнопке «История напоминаний».
            </p>
        `;

        return;
    }

    reminders.forEach(reminder => {
        addReminderToScreen(reminder);
    });
}

// Удаление всегда ограничено открытым аккаунтом и выбранным питомцем.
function createEntryDeleteButton(action, entryId, petId, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-delete-button";
    button.textContent = "Удалить";
    button.dataset.pcClick = action;
    button.dataset.entryId = String(entryId);
    button.dataset.petId = String(petId);
    button.setAttribute("aria-label", label);
    return button;
}

function canDeleteEntry(petId) {
    if (!activeUserId) {
        alert("Войдите в аккаунт, чтобы удалить запись.");
        return false;
    }
    return String(petId) === getActivePetKey();
}

function removeReminderActivity(reminders, petId) {
    const eventIds = new Set();
    appData.activityHistory.forEach(event => {
        if (event.kind !== "reminder" || String(event.petId ?? petId) !== petId) return;
        if (reminders.some(reminder => String(event.id) === `reminder-${reminder.id}-${event.date}`)) {
            eventIds.add(String(event.id));
        }
    });
    appData.activityHistory = appData.activityHistory.filter(event =>
        String(event.petId ?? petId) !== petId || !eventIds.has(String(event.id))
    );
}

function refreshDeletedEntries() {
    updatePetOnScreen();
    renderHealthRecords();
    renderReminders();
    renderHomeReminders();
    renderStories();
}

async function saveEntryDeletion(expectedUserId) {
    refreshDeletedEntries();
    try {
        const synced = await saveData();
        if (!synced && activeUserId === expectedUserId) {
            alert("Удалено на этом устройстве, но сохранить удаление в аккаунте не удалось. Проверьте интернет. До синхронизации запись может появиться снова после входа, а напоминания — продолжить приходить.");
        }
        return Boolean(synced);
    } catch (error) {
        console.error("Не удалось сохранить удаление записи:", error);
        if (activeUserId === expectedUserId) alert("Не удалось сохранить удаление. Проверьте подключение и повторите попытку.");
        return false;
    }
}

async function deleteHealthRecord(recordId, petId = getActivePetKey()) {
    petId = String(petId);
    if (!canDeleteEntry(petId)) return;
    const record = appData.healthRecords.find(item =>
        String(item.id) === String(recordId) && String(item.petId ?? petId) === petId
    );
    if (!record) return;
    if (!window.confirm(`Удалить запись «${record.name}» вместе с фото и напоминанием о повторной процедуре?`)) return;

    const userId = activeUserId;
    const relatedReminders = appData.reminders.filter(reminder =>
        String(reminder.petId ?? petId) === petId
        && (String(reminder.sourceRecordId) === String(record.id) || String(reminder.id) === `health-followup-${record.id}`)
    );
    appData.healthRecords = appData.healthRecords.filter(item => item !== record);
    appData.reminders = appData.reminders.filter(item => !relatedReminders.includes(item));
    removeReminderActivity(relatedReminders, petId);
    await saveEntryDeletion(userId);
}

async function deleteReminder(reminderId, petId = getActivePetKey()) {
    petId = String(petId);
    if (!canDeleteEntry(petId)) return;
    const reminder = appData.reminders.find(item =>
        String(item.id) === String(reminderId) && String(item.petId ?? petId) === petId
    );
    if (!reminder) return;
    const question = ["daily", "weekly"].includes(reminder.repeat)
        ? `Удалить напоминание «${reminder.name}» и все его будущие повторы?`
        : `Удалить напоминание «${reminder.name}»?`;
    if (!window.confirm(question)) return;

    const userId = activeUserId;
    appData.reminders = appData.reminders.filter(item => item !== reminder);
    removeReminderActivity([reminder], petId);
    await saveEntryDeletion(userId);
}

async function deleteWeightEntry(entryId, petId = getActivePetKey()) {
    petId = String(petId);
    if (!canDeleteEntry(petId)) return;
    const pet = appData.pet;
    const entry = (pet.weightHistory || []).find(item => String(item.id) === String(entryId));
    if (!entry) return;
    if (!window.confirm(`Удалить взвешивание ${entry.value} кг за ${formatHistoryDate(entry.date)}?`)) return;

    const userId = activeUserId;
    pet.weightHistory = pet.weightHistory.filter(item => item !== entry);
    const remaining = pet.weightHistory.filter(item => Number(item.value) > 0)
        .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
    pet.weight = remaining.length ? Number(remaining[remaining.length - 1].value) : null;
    const savedPet = appData.pets.find(item => getPetKey(item) === petId);
    if (savedPet) {
        savedPet.weightHistory = pet.weightHistory;
        savedPet.weight = pet.weight;
    }
    appData.activityHistory = appData.activityHistory.filter(event =>
        String(event.petId ?? petId) !== petId || String(event.id) !== `weight-${entry.id}`
    );
    const weight = pet.weight;
    const synced = await saveEntryDeletion(userId);
    const currentPet = appData.pets.find(item => getPetKey(item) === petId);
    if (synced && pet.dbId != null && activeUserId === userId && currentPet?.weight === weight) {
        try {
            const { error } = await supabaseClient.from("pets").update({ weight })
                .eq("id", pet.dbId).eq("user_id", userId);
            if (error) console.warn("Вес сохранён в карточке аккаунта, но не обновлён в таблице питомцев:", error);
        } catch (error) {
            console.warn("Вес сохранён в карточке аккаунта:", error);
        }
    }
}

async function deleteActivityEntry(entryId, petId = getActivePetKey()) {
    petId = String(petId);
    if (!canDeleteEntry(petId)) return;
    const entry = appData.activityHistory.find(item =>
        String(item.id) === String(entryId) && String(item.petId ?? petId) === petId
    );
    if (!entry || !window.confirm(`Удалить событие «${entry.title}» из истории?`)) return;
    const userId = activeUserId;
    appData.activityHistory = appData.activityHistory.filter(item => item !== entry);
    await saveEntryDeletion(userId);
}

async function deleteStory(storyId, petId = getActivePetKey()) {
    petId = String(petId);
    if (!canDeleteEntry(petId)) return;
    const story = appData.storyProjects.find(item =>
        String(item.id) === String(storyId) && String(item.petId) === petId
    );
    if (!story) return;
    const userId = activeUserId;
    const operationKey = `${userId}:${story.id}`;
    if (storyOperationsInProgress.has(operationKey)) {
        alert("Дождитесь сохранения фото или создания коллажа, затем удалите подборку.");
        return;
    }
    if (!window.confirm(`Удалить подборку за ${formatStoryMonth(story.month)} вместе с фото, коллажем и напоминаниями о съёмке?`)) return;

    storyOperationsInProgress.add(operationKey);
    try {
        const reminders = appData.reminders.filter(item =>
            String(item.petId ?? petId) === petId && String(item.sourceStoryId) === String(story.id)
        );
        appData.storyProjects = appData.storyProjects.filter(item => item !== story);
        appData.reminders = appData.reminders.filter(item => !reminders.includes(item));
        removeReminderActivity(reminders, petId);
        const synced = await saveEntryDeletion(userId);
        if (!synced || activeUserId !== userId) return;

        const prefix = `${userId}/${story.id}/`;
        const photos = Array.isArray(story.photos) ? story.photos : [];
        const paths = [...new Set([story.videoPath, story.collagePath, ...photos.map(photo => photo.path)])]
            .filter(path => typeof path === "string" && path.startsWith(prefix) && !path.split("/").includes(".."));
        if (paths.length) {
            const { error } = await supabaseClient.storage.from(STORY_STORAGE_BUCKET).remove(paths);
            paths.forEach(path => {
                const cached = storyMediaUrlCache.get(path);
                if (cached?.url?.startsWith("blob:")) URL.revokeObjectURL(cached.url);
                storyMediaUrlCache.delete(path);
                storyCollageBlobCache.delete(path);
            });
            if (error) throw error;
        }
    } catch (error) {
        console.error("Не удалось очистить файлы удалённой истории:", error);
        if (activeUserId === userId) alert("История удалена из списка, но часть её файлов не удалось удалить из хранилища.");
    } finally {
        storyOperationsInProgress.delete(operationKey);
    }
}

async function withStoryOperation(storyId, operation) {
    const userId = activeUserId;
    const key = `${userId}:${storyId}`;
    if (!userId || storyOperationsInProgress.has(key)) return;
    if (!appData.storyProjects.some(story => String(story.id) === String(storyId) && String(story.petId) === getActivePetKey())) return;
    storyOperationsInProgress.add(key);
    setStoryControlsBusy(storyId, true);
    try {
        return await operation();
    } finally {
        storyOperationsInProgress.delete(key);
        if (activeUserId === userId) setStoryControlsBusy(storyId, false);
    }
}

function pushBase64UrlToBytes(base64Url) {
    const normalized = String(base64Url || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function getPushTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

async function savePushSubscription(subscription, expectedUserId = activeUserId) {
    if (!expectedUserId || expectedUserId !== activeUserId) {
        throw new Error("Войдите в свой аккаунт и повторите попытку.");
    }
    const { error } = await supabaseClient.rpc("petcare_register_push_subscription", {
        p_subscription: subscription.toJSON(),
        p_timezone_name: getPushTimezone()
    });
    if (error) throw error;
}

async function renderPushSettings() {
    const status = document.getElementById("pushSettingsStatus");
    const enableButton = document.getElementById("pushEnableButton");
    const disableButton = document.getElementById("pushDisableButton");
    if (!status || !enableButton || !disableButton) return;

    const userId = activeUserId;
    enableButton.hidden = false;
    enableButton.disabled = false;
    disableButton.hidden = true;

    if (!userId) {
        status.textContent = "Войдите в аккаунт, чтобы настроить уведомления.";
        enableButton.disabled = true;
        return;
    }
    if (!isPetCareInstalled()) {
        status.textContent = "Установите PetCare на главный экран, чтобы получать push-уведомления.";
        enableButton.textContent = "Как установить";
        return;
    }
    enableButton.textContent = "Включить push";
    if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator)) {
        status.textContent = "Этот браузер не поддерживает push-уведомления PetCare.";
        enableButton.disabled = true;
        return;
    }
    if (Notification.permission === "denied") {
        status.textContent = "Уведомления запрещены в настройках телефона или браузера.";
        enableButton.textContent = "Как разрешить";
        return;
    }

    status.textContent = "Проверяю подключение…";
    try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager?.getSubscription();
        if (activeUserId !== userId) return;
        if (!subscription || Notification.permission !== "granted") {
            status.textContent = "Push выключен на этом устройстве.";
            return;
        }

        const { data: linked, error } = await supabaseClient.rpc("petcare_has_push_subscription", {
            p_endpoint: subscription.endpoint
        });
        if (error) throw error;
        if (activeUserId !== userId) return;
        if (linked) {
            await savePushSubscription(subscription, userId);
            if (activeUserId !== userId) return;
            status.textContent = "Включено для этого аккаунта. Напоминания проверяются каждую минуту.";
            enableButton.hidden = true;
            disableButton.hidden = false;
        } else {
            status.textContent = "Разрешение на телефоне есть. Подключите push к этому аккаунту.";
            enableButton.textContent = "Подключить push";
        }
    } catch (error) {
        console.error("Не удалось проверить push-подписку:", error);
        status.textContent = "Не удалось проверить статус. Попробуйте обновить страницу.";
    }
}

async function enablePushNotifications() {
    if (!activeUserId) {
        alert("Сначала войдите в аккаунт PetCare.");
        return;
    }
    if (!isPetCareInstalled()) {
        openInstallHelp(isAppleMobileDevice() ? "ios" : "android");
        return;
    }
    if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator)) {
        alert("Push-уведомления недоступны в этом браузере. Откройте установленный PetCare в актуальном Safari или Chrome.");
        return;
    }

    try {
        const permission = Notification.permission === "default"
            ? await Notification.requestPermission()
            : Notification.permission;
        if (permission !== "granted") {
            alert(permission === "denied"
                ? "Разрешите уведомления PetCare в настройках телефона или браузера, затем попробуйте снова."
                : "Для push-напоминаний нужно разрешить уведомления.");
            await renderPushSettings();
            return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: pushBase64UrlToBytes(PUSH_VAPID_PUBLIC_KEY)
            });
        }
        const userId = activeUserId;
        await savePushSubscription(subscription, userId);
        if (activeUserId !== userId) return;
        const status = document.getElementById("pushSettingsStatus");
        if (status) status.textContent = "Готово! Напоминания будут приходить на это устройство.";
        await renderPushSettings();
    } catch (error) {
        console.error("Не удалось включить push-уведомления:", error);
        alert("Не удалось включить push-уведомления. Проверьте интернет и разрешение на уведомления, затем попробуйте снова.");
        await renderPushSettings();
    }
}

async function disablePushNotifications(options = {}) {
    const silent = Boolean(options.silent);
    if (!activeUserId) return;
    try {
        const registration = await navigator.serviceWorker?.getRegistration("/");
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
            const { error } = await supabaseClient.rpc("petcare_unregister_push_subscription", {
                p_endpoint: subscription.endpoint
            });
            if (error) throw error;
            await subscription.unsubscribe();
        }
        if (!silent) await renderPushSettings();
    } catch (error) {
        console.error("Не удалось отключить push-уведомления:", error);
        if (!silent) alert("Не удалось отключить уведомления на сервере. Попробуйте ещё раз.");
    }
}

// ==============================
// КОЛЛАЖИ ПИТОМЦА
// ==============================

function formatStoryMonth(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return "Подборка питомца";
    const label = new Date(monthKey + "-01T12:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    return label.charAt(0).toLocaleUpperCase("ru-RU") + label.slice(1);
}

function getStorySignedUrl(path) {
    const cached = storyMediaUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now() + 60000) return Promise.resolve(cached.url);
    return supabaseClient.storage.from(STORY_STORAGE_BUCKET).createSignedUrl(path, 3600).then(({ data, error }) => {
        if (error || !data?.signedUrl) throw error || new Error("Не удалось открыть фото.");
        storyMediaUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 3500000 });
        return data.signedUrl;
    });
}

function setStoryMediaSource(element, path) {
    const userId = activeUserId;
    getStorySignedUrl(path).then(url => {
        if (element.isConnected && activeUserId === userId) element.src = url;
    }).catch(error => {
        if (element.isConnected) element.alt = "Фото пока недоступно. Проверьте подключение.";
        console.warn("Не удалось загрузить фото:", error);
    });
}

function getStoryPhotos(story) {
    return [1, 2, 3, 4].map(week => (story.photos || []).find(photo => Number(photo.week) === week && photo.path))
        .filter(Boolean).sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")) || Number(left.week) - Number(right.week));
}

function getStoryCollageSignature(story) {
    const pet = appData.pets.find(item => getPetKey(item) === String(story.petId)) || appData.pet;
    return JSON.stringify([pet?.name || "Питомец", story.month, story.collageLayout || "grid",
        getStoryPhotos(story).map(photo => [photo.week, photo.path, photo.date])]);
}

function isStoryCollageCurrent(story) {
    return Boolean(story.collagePath && story.collageSignature === getStoryCollageSignature(story));
}

function findCurrentStory(storyId) {
    return appData.storyProjects.find(story => String(story.id) === String(storyId) && String(story.petId) === getActivePetKey());
}

function createStoryButton(label, action, story, week) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-week-button";
    button.textContent = label;
    button.dataset.pcClick = action;
    button.dataset.storyId = story.id;
    if (week) button.dataset.storyWeek = String(week);
    return button;
}

function makeStoryWeekCard(story, week) {
    const photo = (story.photos || []).find(item => Number(item.week) === week && item.path);
    const slot = document.createElement("article");
    slot.className = "story-week";
    const imageWrap = document.createElement("div");
    imageWrap.className = "story-week-image-wrap";
    if (photo) {
        const image = document.createElement("img");
        image.className = "story-week-photo";
        image.alt = `Фото ${appData.pet?.name || "питомца"}, кадр ${week}`;
        image.loading = "lazy";
        setStoryMediaSource(image, photo.path);
        imageWrap.appendChild(image);
    } else {
        const placeholder = document.createElement("span");
        placeholder.className = "story-week-empty";
        placeholder.textContent = "📷";
        imageWrap.appendChild(placeholder);
    }
    const info = document.createElement("div");
    info.className = "story-week-info";
    const title = document.createElement("strong");
    title.textContent = `Кадр ${week}`;
    info.appendChild(title);
    if (photo) {
        const label = document.createElement("label");
        label.className = "story-photo-date-label";
        label.textContent = "Дата фото";
        const date = document.createElement("input");
        date.type = "date";
        date.value = photo.date || "";
        date.dataset.pcChange = "story-photo-date";
        date.dataset.storyId = story.id;
        date.dataset.storyWeek = String(week);
        date.setAttribute("aria-label", `Дата фото, кадр ${week}`);
        label.appendChild(date);
        info.appendChild(label);
    } else {
        const empty = document.createElement("small");
        empty.textContent = "Добавьте момент взросления";
        info.appendChild(empty);
    }
    info.appendChild(createStoryButton(photo ? "↻ Заменить фото" : "＋ Загрузить фото", "story-take-photo", story, week));
    const camera = createStoryButton("📸 Камера", "story-camera", story, week);
    camera.classList.add("story-camera-button");
    info.appendChild(camera);
    slot.append(imageWrap, info);
    return slot;
}

function setStoryStatus(storyId, text) {
    const card = [...document.querySelectorAll("[data-story-card-id]")].find(item => item.dataset.storyCardId === String(storyId));
    const status = card?.querySelector(".story-status");
    if (status) status.textContent = text;
}

function setStoryControlsBusy(storyId, busy) {
    const story = findCurrentStory(storyId);
    const card = [...document.querySelectorAll("[data-story-card-id]")].find(item => item.dataset.storyCardId === String(storyId));
    if (!card || !story) return;
    card.setAttribute("aria-busy", String(busy));
    card.querySelectorAll("button, input, select").forEach(control => {
        control.disabled = busy || Number(control.dataset.minPhotos || 0) > getStoryPhotos(story).length;
    });
}

function renderStoryCard(story, container) {
    const card = document.createElement("article");
    card.className = "story-card";
    card.dataset.storyCardId = story.id;
    const count = getStoryPhotos(story).length;
    const heading = document.createElement("div");
    heading.className = "story-card-heading";
    const titleBlock = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = formatStoryMonth(story.month);
    const subtitle = document.createElement("small");
    subtitle.textContent = `${appData.pet?.name || "Питомец"} · ${count} из 4 фото`;
    titleBlock.append(title, subtitle);
    heading.append(titleBlock, createEntryDeleteButton("story-delete", story.id, story.petId, `Удалить коллаж за ${formatStoryMonth(story.month)}`));
    const progressTrack = document.createElement("div");
    progressTrack.className = "story-progress-track";
    progressTrack.setAttribute("role", "progressbar");
    progressTrack.setAttribute("aria-label", "Количество добавленных фотографий");
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", "4");
    progressTrack.setAttribute("aria-valuenow", String(count));
    const progress = document.createElement("div");
    progress.className = "story-progress-value";
    progress.style.width = `${count * 25}%`;
    progressTrack.appendChild(progress);
    card.append(heading, progressTrack);
    if (count < 4) {
        const upload = createStoryButton("＋ Загрузить несколько фото", "story-upload-many", story);
        upload.classList.add("story-batch-button");
        card.appendChild(upload);
    }
    const weekGrid = document.createElement("div");
    weekGrid.className = "story-week-grid";
    [1, 2, 3, 4].forEach(week => weekGrid.appendChild(makeStoryWeekCard(story, week)));
    const layoutLabel = document.createElement("label");
    layoutLabel.className = "story-layout-label";
    layoutLabel.textContent = "Оформление коллажа";
    const layout = document.createElement("select");
    layout.dataset.pcChange = "story-layout";
    layout.dataset.storyId = story.id;
    [["grid", "Сетка · кадры рядом"], ["timeline", "Лента · история роста"]].forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        layout.appendChild(option);
    });
    layout.value = story.collageLayout || "grid";
    layoutLabel.appendChild(layout);
    const status = document.createElement("p");
    status.className = "story-status story-save-note";
    status.setAttribute("role", "status");
    status.textContent = isStoryCollageCurrent(story) ? "Коллаж сохранён в аккаунте. Скачайте его или поделитесь."
        : count >= 2 ? "Фото готовы. Проверьте даты и создайте коллаж. Ожидать конца месяца не нужно."
            : "Добавьте хотя бы 2 фото. Можно выбрать до 4 снимков сразу.";
    const generate = createStoryButton(story.collagePath ? "↻ Обновить коллаж" : "✨ Создать коллаж", "story-generate", story);
    generate.className = "primary-button story-generate-button";
    generate.dataset.minPhotos = "2";
    card.append(weekGrid, layoutLabel, status, generate);
    if (isStoryCollageCurrent(story)) {
        const image = document.createElement("img");
        image.className = "story-collage-preview";
        image.alt = `Коллаж: как растёт ${appData.pet?.name || "питомец"}`;
        image.loading = "lazy";
        setStoryMediaSource(image, story.collagePath);
        const save = createStoryButton("⬇ Скачать / поделиться", "story-save-collage", story);
        save.className = "secondary-button story-save-button";
        const note = document.createElement("p");
        note.className = "story-save-note";
        note.textContent = "На телефоне выберите сохранение изображения в меню «Поделиться». Если меню недоступно, коллаж скачается файлом JPEG.";
        card.append(image, save, note);
    }
    container.appendChild(card);
    setStoryControlsBusy(story.id, storyOperationsInProgress.has(`${activeUserId}:${story.id}`));
}

function renderStories() {
    const container = document.getElementById("storiesList");
    if (!container) return;
    container.replaceChildren();
    const stories = (appData.storyProjects || []).filter(story => String(story.petId) === getActivePetKey())
        .sort((left, right) => String(right.month || "").localeCompare(String(left.month || "")));
    if (!stories.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Здесь появятся коллажи вашего питомца. Начните с двух любимых фотографий.";
        container.appendChild(empty);
    }
    stories.forEach(story => renderStoryCard(story, container));
}

function openStorySetup() {
    if (!activeUserId || appData.pet?.isPlaceholder) {
        alert("Войдите в аккаунт и добавьте питомца, чтобы сохранять коллажи.");
        return;
    }
    const today = getLocalDateInputValue();
    document.getElementById("storyMonthInput").value = today.slice(0, 7);
    document.getElementById("storyStartDateInput").value = today;
    document.getElementById("storyRemindersEnabled").checked = false;
    document.getElementById("storyReminderTimeInput").disabled = true;
    const dialog = document.getElementById("storySetupDialog");
    dialog.dataset.userId = activeUserId;
    dialog.dataset.petId = getActivePetKey();
    dialog.showModal();
}

async function createStoryPlan() {
    const dialog = document.getElementById("storySetupDialog");
    if (!activeUserId || appData.pet?.isPlaceholder || dialog.dataset.userId !== activeUserId || dialog.dataset.petId !== getActivePetKey()) return;
    const month = document.getElementById("storyMonthInput").value;
    const startDate = document.getElementById("storyStartDateInput").value;
    const time = document.getElementById("storyReminderTimeInput").value || "09:00";
    const remindersEnabled = document.getElementById("storyRemindersEnabled").checked;
    if (!/^\d{4}-\d{2}$/.test(month) || !startDate) {
        alert("Укажите месяц подборки и дату начала наблюдения.");
        return;
    }
    const userId = activeUserId;
    const petId = getActivePetKey();
    const storyId = createEntryId("story");
    appData.storyProjects.push({ id: storyId, petId, month, startDate, createdAt: new Date().toISOString(), photos: [], collageLayout: "grid" });
    if (remindersEnabled) {
        for (let week = 1; week <= 4; week += 1) {
            const dueDate = new Date(startDate + "T12:00:00");
            dueDate.setDate(dueDate.getDate() + (week - 1) * 7);
            appData.reminders.push({
                id: `story-reminder-${storyId}-${week}`, type: "Фото питомца", name: `Фото для коллажа · неделя ${week}`,
                date: getLocalDateInputValue(dueDate), time, repeat: "once", photos: [], petId, completed: false,
                completedForDate: null, sourceStoryId: storyId, sourceStoryWeek: week
            });
        }
    }
    dialog.close();
    renderStories();
    renderReminders();
    renderHomeReminders();
    renderCalendar();
    const synced = await saveData();
    if (activeUserId === userId && !synced) alert("Подборка сохранена на устройстве. Для синхронизации с аккаунтом проверьте подключение.");
}

function requestStoryPhoto(button, camera = false, multiple = false) {
    const story = findCurrentStory(button?.dataset.storyId);
    if (!activeUserId || !story || storyOperationsInProgress.has(`${activeUserId}:${story.id}`)) return;
    const input = document.getElementById(camera ? "storyCameraInput" : "storyPhotoInput");
    input.dataset.storyId = story.id;
    input.dataset.storyWeek = multiple ? "" : button.dataset.storyWeek;
    input.dataset.userId = activeUserId;
    input.dataset.petId = getActivePetKey();
    input.multiple = multiple;
    input.value = "";
    input.click();
}

function storyPhotoDataToBlob(dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("Не удалось подготовить фото.");
    const binary = atob(match[2]);
    return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: match[1] });
}

async function removeUnusedStoryFiles(paths, story, userId) {
    if (activeUserId !== userId) return;
    const prefix = `${userId}/${story.id}/`;
    const safePaths = [...new Set(paths)].filter(path => typeof path === "string" && path.startsWith(prefix) && !path.split("/").includes(".."));
    if (!safePaths.length) return;
    const { error } = await supabaseClient.storage.from(STORY_STORAGE_BUCKET).remove(safePaths);
    if (error) { console.warn("Не удалось удалить прежние файлы коллажа:", error); return; }
    safePaths.forEach(path => {
        const cached = storyMediaUrlCache.get(path);
        if (cached?.url?.startsWith("blob:")) URL.revokeObjectURL(cached.url);
        storyMediaUrlCache.delete(path);
        storyCollageBlobCache.delete(path);
    });
}

async function handleStoryPhotoSelection(input) {
    const files = [...(input.files || [])];
    const week = Number(input.dataset.storyWeek);
    const story = findCurrentStory(input.dataset.storyId);
    const userId = activeUserId;
    input.value = "";
    if (!files.length || !story || !userId || input.dataset.userId !== userId || input.dataset.petId !== getActivePetKey()) return;
    const slots = week >= 1 && week <= 4 ? [week] : [1, 2, 3, 4].filter(slot => !(story.photos || []).some(photo => Number(photo.week) === slot && photo.path));
    if (!slots.length) { alert("Все четыре кадра заполнены. Замените нужное фото отдельно."); return; }
    const isCurrent = () => activeUserId === userId && appData.storyProjects.includes(story);
    let added = 0;
    const errors = [];
    if (files.length > slots.length) errors.push(`В подборке осталось мест: ${slots.length}. Лишние фото не добавлены.`);
    try {
        for (const file of files.slice(0, slots.length)) {
            if (!isCurrent()) return;
            if ((!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name)) || file.size > 20 * 1024 * 1024) {
                errors.push(`${file.name}: выберите фотографию до 20 МБ.`);
                continue;
            }
            const slot = slots[added];
            setStoryStatus(story.id, `Загружаю фото ${added + 1} из ${Math.min(files.length, slots.length)}…`);
            let photoData;
            try { photoData = await compressPetPhoto(file, 1800, 0.88); }
            catch { errors.push(`${file.name}: фото не открылось. Попробуйте JPEG, PNG или WebP.`); continue; }
            if (!isCurrent()) return;
            const path = `${userId}/${story.id}/photo-${slot}-${createEntryId("image")}.jpg`;
            const { error } = await supabaseClient.storage.from(STORY_STORAGE_BUCKET).upload(path, storyPhotoDataToBlob(photoData), {
                cacheControl: "3600", contentType: "image/jpeg", upsert: false
            });
            if (error) throw error;
            if (!isCurrent()) return;
            const previous = (story.photos || []).find(photo => Number(photo.week) === slot);
            const oldCollage = story.collagePath;
            story.photos = (story.photos || []).filter(photo => Number(photo.week) !== slot);
            const fileDate = file.lastModified ? getLocalDateInputValue(new Date(file.lastModified)) : getLocalDateInputValue();
            story.photos.push({ week: slot, path, date: previous?.date || fileDate, takenAt: new Date().toISOString() });
            story.collagePath = null;
            story.collageSignature = null;
            storyMediaUrlCache.set(path, { url: photoData, expiresAt: Number.MAX_SAFE_INTEGER });
            const reminder = appData.reminders.find(item => item.sourceStoryId === story.id && Number(item.sourceStoryWeek) === slot && String(item.petId) === String(story.petId));
            if (reminder) reminder.completed = true;
            added += 1;
            const synced = await saveData();
            if (!isCurrent()) return;
            if (synced) await removeUnusedStoryFiles([previous?.path, oldCollage], story, userId);
            else errors.push("Фото сохранено на устройстве, но синхронизация подборки ещё не завершена. Проверьте подключение.");
        }
    } catch (error) {
        console.error("Не удалось загрузить фото коллажа:", error);
        errors.push("Загрузка прервана. Уже добавленные фото сохранены; остальные можно выбрать ещё раз.");
    } finally {
        if (isCurrent()) {
            if (getActivePetKey() === String(story.petId)) {
                renderStories(); renderReminders(); renderHomeReminders(); renderCalendar();
                setStoryStatus(story.id, errors.length ? errors.join(" ") : `Добавлено фото: ${added}. Проверьте даты снимков перед созданием коллажа.`);
            }
            if (errors.length) alert(errors.join("\n"));
        }
    }
}

async function updateStoryCollageSetting(input) {
    const story = findCurrentStory(input.dataset.storyId);
    if (!story || !activeUserId) return;
    const userId = activeUserId;
    if (input.dataset.pcChange === "story-layout") {
        if (!["grid", "timeline"].includes(input.value)) return;
        story.collageLayout = input.value;
    } else {
        if (!input.value || !input.validity.valid) { renderStories(); return; }
        const photo = (story.photos || []).find(item => Number(item.week) === Number(input.dataset.storyWeek));
        if (!photo) return;
        photo.date = input.value;
    }
    renderStories();
    const synced = await saveData();
    if (activeUserId === userId && !synced) setStoryStatus(story.id, "Изменение сохранено на устройстве. Проверьте подключение для синхронизации.");
}

async function loadStoryImage(path) {
    const { data, error } = await supabaseClient.storage.from(STORY_STORAGE_BUCKET).download(path);
    if (error || !data) throw error || new Error("Не удалось загрузить фото для коллажа.");
    const objectUrl = URL.createObjectURL(data);
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ image, objectUrl });
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Не удалось открыть фото для коллажа.")); };
        image.src = objectUrl;
    });
}

function drawCollagePhoto(context, image, x, y, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2,
        sourceWidth, sourceHeight, x, y, width, height);
}

function drawStoryCollage(story, photos, images, petName) {
    const timeline = story.collageLayout === "timeline";
    const width = 1600;
    const margin = 64;
    const gap = 28;
    const top = 246;
    const cellWidth = timeline ? width - margin * 2 : (width - margin * 2 - gap) / 2;
    const photoHeight = timeline ? 690 : 650;
    const captionHeight = 108;
    const rows = timeline ? photos.length : Math.ceil(photos.length / 2);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = top + rows * (photoHeight + captionHeight + gap) - gap + 100;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог создать изображение коллажа.");
    context.fillStyle = "#eff5ef";
    context.fillRect(0, 0, width, canvas.height);
    context.fillStyle = "#537c65";
    context.font = "bold 23px Arial";
    context.fillText("PETCARE · ИСТОРИЯ РОСТА", margin, 67);
    context.fillStyle = "#174c3b";
    context.font = "bold 66px Arial";
    let name = petName;
    while (context.measureText(name).width > width - margin * 2 && name.length > 1) name = name.slice(0, -1);
    if (name !== petName) name = name.slice(0, -1) + "…";
    context.fillText(name, margin, 148);
    context.fillStyle = "#6b8173";
    context.font = "28px Arial";
    context.fillText(`Как растёт мой питомец · ${formatStoryMonth(story.month)}`, margin, 200);
    photos.forEach((photo, index) => {
        const row = timeline ? index : Math.floor(index / 2);
        const col = timeline ? 0 : index % 2;
        const loneLast = !timeline && photos.length % 2 && index === photos.length - 1;
        const x = loneLast ? (width - cellWidth) / 2 : margin + col * (cellWidth + gap);
        const y = top + row * (photoHeight + captionHeight + gap);
        context.save();
        context.beginPath();
        if (context.roundRect) context.roundRect(x, y, cellWidth, photoHeight + captionHeight, 28);
        else context.rect(x, y, cellWidth, photoHeight + captionHeight);
        context.clip();
        context.fillStyle = "#ffffff";
        context.fillRect(x, y, cellWidth, photoHeight + captionHeight);
        drawCollagePhoto(context, images[index].image, x, y, cellWidth, photoHeight);
        context.fillStyle = "#174c3b";
        context.font = "bold 27px Arial";
        context.fillText(`${String(index + 1).padStart(2, "0")}  ·  ${formatHistoryDate(photo.date)}`, x + 26, y + photoHeight + 48);
        context.fillStyle = "#7b8d80";
        context.font = "22px Arial";
        context.fillText(index === 0 ? "Начало нашей истории" : "Ещё один момент вместе", x + 26, y + photoHeight + 82);
        context.restore();
    });
    context.fillStyle = "#7b8d80";
    context.font = "23px Arial";
    context.fillText("Маленькие моменты. Большая любовь.", margin, canvas.height - 38);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Не удалось сохранить изображение коллажа.")), "image/jpeg", 0.92));
}

async function generatePetStoryCollage(button) {
    const story = findCurrentStory(button?.dataset.storyId);
    const userId = activeUserId;
    if (!story || !userId) return;
    const photos = getStoryPhotos(story);
    if (photos.length < 2) { alert("Добавьте хотя бы 2 фото питомца."); return; }
    const signature = getStoryCollageSignature(story);
    const petName = appData.pet?.name || "Мой питомец";
    const isCurrent = () => activeUserId === userId && appData.storyProjects.includes(story);
    const loaded = [];
    try {
        setStoryStatus(story.id, "Создаю коллаж…");
        for (const photo of photos) {
            loaded.push(await loadStoryImage(photo.path));
            if (!isCurrent()) return;
        }
        const blob = await drawStoryCollage(story, photos, loaded, petName);
        if (!isCurrent()) return;
        if (signature !== getStoryCollageSignature(story)) {
            setStoryStatus(story.id, "Данные подборки изменились. Создайте коллаж ещё раз.");
            return;
        }
        const path = `${userId}/${story.id}/${createEntryId("collage")}.jpg`;
        const { error } = await supabaseClient.storage.from(STORY_STORAGE_BUCKET).upload(path, blob, {
            cacheControl: "3600", contentType: "image/jpeg", upsert: false
        });
        if (error) throw error;
        if (!isCurrent()) return;
        const oldPath = story.collagePath;
        story.collagePath = path;
        story.collageCreatedAt = new Date().toISOString();
        story.collageSignature = signature;
        storyMediaUrlCache.set(path, { url: URL.createObjectURL(blob), expiresAt: Number.MAX_SAFE_INTEGER });
        storyCollageBlobCache.set(path, blob);
        const synced = await saveData();
        if (!isCurrent()) return;
        if (synced) await removeUnusedStoryFiles([oldPath], story, userId);
        if (getActivePetKey() === String(story.petId)) renderStories();
        if (!synced) setStoryStatus(story.id, "Коллаж создан и доступен для скачивания. Данные подборки пока не синхронизированы — проверьте подключение.");
    } catch (error) {
        console.error("Не удалось создать коллаж:", error);
        if (isCurrent()) setStoryStatus(story.id, "Не удалось создать коллаж. Проверьте подключение и повторите попытку.");
    } finally {
        loaded.forEach(item => URL.revokeObjectURL(item.objectUrl));
    }
}

function triggerStoryCollageDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function saveStoryCollage(button) {
    const story = findCurrentStory(button?.dataset.storyId);
    const userId = activeUserId;
    if (!userId || !story || !isStoryCollageCurrent(story)) return;
    const path = story.collagePath;
    const filename = `PetCare-${story.month}.jpg`;
    try {
        let blob = storyCollageBlobCache.get(path);
        if (!blob) {
            const { data, error } = await supabaseClient.storage.from(STORY_STORAGE_BUCKET).download(path);
            if (error || !data) throw error || new Error("Не удалось загрузить коллаж.");
            blob = data;
            storyCollageBlobCache.set(path, blob);
        }
        if (activeUserId !== userId || !appData.storyProjects.includes(story) || story.collagePath !== path) return;
        const file = new File([blob], filename, { type: "image/jpeg" });
        const shareData = { files: [file], title: "Как растёт мой питомец · PetCare" };
        if (navigator.share && navigator.canShare?.(shareData)) {
            try { await navigator.share(shareData); return; }
            catch (error) { if (error?.name === "AbortError") return; }
        }
        triggerStoryCollageDownload(blob, filename);
        setStoryStatus(story.id, "Коллаж скачан в формате JPEG. На телефоне откройте файл и выберите сохранение в Фото / Галерею.");
    } catch (error) {
        console.error("Не удалось сохранить коллаж:", error);
        if (activeUserId === userId) setStoryStatus(story.id, "Не удалось скачать коллаж. Проверьте подключение и попробуйте ещё раз.");
    }
}



function isHomeTaskCompleted(taskId, date = getLocalDateInputValue()) {
    const petId = getActivePetKey();
    return appData.completedTasks.some(task =>
        task.id === taskId && task.date === date && task.petId === petId
    );
}

function updateHomeTaskState(taskElement) {
    const taskId = taskElement?.getAttribute("data-task");
    if (!taskId) return;

    const completed = isHomeTaskCompleted(taskId);
    taskElement.classList.toggle("done", completed);
    const button = taskElement.querySelector(".task-complete");
    if (!button) return;
    button.textContent = completed ? "✓" : "○";
    button.setAttribute("aria-pressed", String(completed));
    button.setAttribute("aria-label", completed ? "Снять отметку выполнения" : "Отметить выполненным");
}

async function completeTask(element, taskId) {
    const taskElement = element?.matches(".task") ? element : element?.closest(".task");
    if (!taskElement) return;

    const date = getLocalDateInputValue();
    const petId = getActivePetKey();
    const selectedTaskId = taskId || taskElement.getAttribute("data-task");
    const existingIndex = appData.completedTasks.findIndex(task =>
        task.id === selectedTaskId && task.date === date && task.petId === petId
    );

    if (existingIndex >= 0) {
        appData.completedTasks.splice(existingIndex, 1);
    } else {
        appData.completedTasks.push({ id: selectedTaskId, date, petId });
        const taskNames = { feeding: "Кормление", walk: "Прогулка", vitamins: "Витамины" };
        addActivityEvent("task", `Выполнено: ${taskNames[selectedTaskId] || selectedTaskId}`, date, "Задача ухода", `task-${selectedTaskId}-${date}`);
    }

    updateHomeTaskState(taskElement);
    await saveData();
    renderEventHistory();
    renderCalendar();
}


// ==============================
// ВОССТАНОВИТЬ ВЫПОЛНЕННЫЕ ЗАДАЧИ
// ==============================

function restoreTasks() {
    document.querySelectorAll("#homePage .task[data-task]").forEach(updateHomeTaskState);
}


// ==============================
// ТЕКУЩАЯ ДАТА
// ==============================

function setTodayDate() {
    const dateElement = document.getElementById("todayDate");

    if (!dateElement) {
        return;
    }

    const today = new Date();

    const options = {
        day: "numeric",
        month: "long"
    };

    dateElement.textContent = today.toLocaleDateString(
        "ru-RU",
        options
    );
}
// ==============================
// РЕГИСТРАЦИЯ И ВХОД
// ==============================

function showLoginForm() {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const loginTab = document.getElementById("loginTab");
    const registerTab = document.getElementById("registerTab");
    const message = document.getElementById("authMessage");

    if (loginForm) loginForm.style.display = "block";
    if (registerForm) registerForm.style.display = "none";
    if (loginTab) loginTab.classList.add("active");
    if (registerTab) registerTab.classList.remove("active");
    if (message) message.textContent = "";
}


function showRegisterForm() {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const loginTab = document.getElementById("loginTab");
    const registerTab = document.getElementById("registerTab");
    const message = document.getElementById("authMessage");

    if (loginForm) loginForm.style.display = "none";
    if (registerForm) registerForm.style.display = "block";
    if (loginTab) loginTab.classList.remove("active");
    if (registerTab) registerTab.classList.add("active");
    if (message) message.textContent = "";
}


// ==============================
// РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЯ
// ==============================

async function registerUser() {
    const emailInput = document.getElementById("registerEmail");
    const passwordInput = document.getElementById("registerPassword");
    const password2Input = document.getElementById("registerPassword2");
    const message = document.getElementById("authMessage");

    if (!emailInput || !passwordInput || !password2Input || !message) {
        console.error("Не найдены поля регистрации в index.html");
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const password2 = password2Input.value;

    if (!email || !password || !password2) {
        message.textContent = "Заполни все поля.";
        return;
    }

    if (password.length < 6) {
        message.textContent = "Пароль должен содержать минимум 6 символов.";
        return;
    }

    if (password !== password2) {
        message.textContent = "Пароли не совпадают.";
        return;
    }

    message.textContent = "Регистрация...";

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                emailRedirectTo: "https://stormman745.github.io/"
            }
        });

        if (error) {
            console.error("Ошибка регистрации:", error);
            message.textContent = "Ошибка регистрации: " + error.message;
            return;
        }

        if (!data.session) {
            message.textContent =
                "Регистрация успешна! Проверь почту и подтверди email.";
            return;
        }

        message.textContent = "Регистрация успешна! 🐾";
        openMainAfterLogin();

    } catch (error) {
        console.error("Ошибка регистрации:", error);
        message.textContent = "Не удалось выполнить регистрацию.";
    }
}


// ==============================
// ВХОД ПОЛЬЗОВАТЕЛЯ
// ==============================

async function loginUser() {
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const message = document.getElementById("authMessage");

    if (!emailInput || !passwordInput || !message) {
        console.error("Не найдены поля входа в index.html");
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        message.textContent = "Введите email и пароль.";
        return;
    }

    message.textContent = "Выполняется вход...";

    try {
        const { data, error } =
            await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

        if (error) {
            console.error("Ошибка входа:", error);
            message.textContent =
                error.message.toLowerCase().includes("email not confirmed")
                    ? "Сначала подтверди email через письмо."
                    : "Ошибка входа: " + error.message;
            return;
        }

        if (!data.user) {
            message.textContent = "Не удалось подтвердить вход.";
            return;
        }

        message.textContent = "Вход выполнен! 🐾";
        await openMainAfterLogin();

    } catch (error) {
        console.error("Ошибка входа:", error);
        message.textContent = "Не удалось выполнить вход. Проверь интернет и консоль F12.";
    }
}

// ==============================
// ОТКРЫТЬ ГЛАВНУЮ ПОСЛЕ ВХОДА
// ==============================

async function openMainAfterLogin() {
    const authPage = document.getElementById("authPage");
    const bottomMenu = document.querySelector(".bottom-menu");

    const { data: authData, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !authData.user) {
        console.error("Не удалось определить пользователя для загрузки данных:", authError);
        return;
    }

    const userId = authData.user.id;
    await loadDataFromDatabase(userId);
    if (activeUserId !== userId) return;

    setTodayDate();
    updatePetOnScreen();
    renderHealthRecords();
    renderReminders();
    restoreTasks();

    await loadPetFromDatabase(userId);
    if (activeUserId !== userId) return;

    await loadUserProfile(userId);
    if (activeUserId !== userId) return;
    startAssistantProfileLive();

    if (authPage) authPage.style.display = "none";
    if (bottomMenu) bottomMenu.style.display = "flex";
    if (new URLSearchParams(window.location.search).get("page") === "reminders") {
        showReminders();
        window.history.replaceState({}, "", window.location.pathname);
    } else {
        showHome();
    }
}


// ==============================
// ПРОВЕРКА АВТОРИЗАЦИИ
// ==============================

async function checkAuth() {
    try {
        const { data, error } = await supabaseClient.auth.getUser();

        if (error) {
            console.error("Ошибка проверки входа:", error);
        }

        const authPage = document.getElementById("authPage");
        const homePage = document.getElementById("homePage");
        const bottomMenu = document.querySelector(".bottom-menu");

        if (data && data.user) {
            await openMainAfterLogin();
        } else {
            resetActiveAccountData();
            if (authPage) authPage.style.display = "flex";
            if (homePage) homePage.style.display = "none";
            if (bottomMenu) bottomMenu.style.display = "none";

            showLoginForm();
        }
    } catch (error) {
        console.error("Ошибка проверки авторизации:", error);
    }
}


// ==============================
// ВЫХОД ИЗ АККАУНТА
// ==============================

async function logoutUser() {
    try {
        await disablePushNotifications({ silent: true });
        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            console.error("Ошибка выхода:", error);
            alert("Не удалось выйти из аккаунта: " + error.message);
            return;
        }

        const authPage = document.getElementById("authPage");
        const bottomMenu = document.querySelector(".bottom-menu");

        hideAllPages();
        if (authPage) authPage.style.display = "flex";
        if (bottomMenu) bottomMenu.style.display = "none";

        resetActiveAccountData();
        showLoginForm();
    } catch (error) {
        console.error("Ошибка выхода:", error);
        alert("Не удалось выйти из аккаунта.");
    }
}


// ==============================
// ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
// ==============================

async function loadUserProfile(expectedUserId = activeUserId) {
    try {
        const { data, error } = await supabaseClient.auth.getUser();

        if (error || !data.user || data.user.id !== expectedUserId || activeUserId !== expectedUserId) {
            return;
        }

        const emailElement = document.getElementById("userEmail");

        if (emailElement) {
            emailElement.textContent = data.user.email || "";
        }
    } catch (error) {
        console.error("Ошибка загрузки профиля:", error);
    }
}


// ==============================
// СЛЕДИМ ЗА ИЗМЕНЕНИЕМ АВТОРИЗАЦИИ
// ==============================

supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("Auth event:", event);

    if (session?.user?.id && activeUserId && session.user.id !== activeUserId) {
        resetActiveAccountData();
        hideAllPages();
        const authPage = document.getElementById("authPage");
        if (authPage) authPage.style.display = "flex";
        const menu = document.querySelector(".bottom-menu");
        if (menu) menu.style.display = "none";
        window.setTimeout(() => checkAuth(), 0);
        return;
    }

    if (event === "SIGNED_OUT") {
        const authPage = document.getElementById("authPage");
        const bottomMenu = document.querySelector(".bottom-menu");

        hideAllPages();
        if (authPage) authPage.style.display = "flex";
        if (bottomMenu) bottomMenu.style.display = "none";

        resetActiveAccountData();
        showLoginForm();
    }
});


// ==============================
// ЗАПУСК ПРИЛОЖЕНИЯ
// ==============================

async function startApp() {
    const authPage = document.getElementById("authPage");
    const homePage = document.getElementById("homePage");
    const bottomMenu = document.querySelector(".bottom-menu");

    if (authPage) authPage.style.display = "flex";
    if (homePage) homePage.style.display = "none";
    if (bottomMenu) bottomMenu.style.display = "none";

    showLoginForm();
    await checkAuth();
}

document.getElementById("petPhotoInput")?.addEventListener("change", handlePetPhotoSelection);
document.getElementById("recordPhotoInput")?.addEventListener("change", event => queueAttachmentPhotoSelection(event, "health"));
document.getElementById("reminderPhotoInput")?.addEventListener("change", event => queueAttachmentPhotoSelection(event, "reminder"));
document.getElementById("animalInput")?.addEventListener("change", event => {
    window.PetCareExperience?.previewPet({ animal: event.target.value, name: document.getElementById("nameInput")?.value });
    const currentPhoto = pendingPetPhoto !== undefined
        ? pendingPetPhoto
        : (petFormMode === "create" ? null : appData.pet?.photoData);
    if (!currentPhoto) {
        renderPetAvatar(document.getElementById("petPhotoPreview"), { animal: event.target.value });
    }
});

startApp();
function showAssistant() {
    hideAllPages();
    markActiveNavigation("nav-assistant");
    const assistantPage = document.getElementById("assistantPage");

    if (assistantPage) assistantPage.style.display = "block";

    renderPetSwitcher();
    startAssistantProfileLive();
    updateAssistantProfileStatus();
    renderAssistantConversation();
}

function cancelAssistantRequest() {
    const request = activeAssistantRequest;
    activeAssistantRequest = null;
    if (request) {
        request.controller.abort();
        window.clearTimeout(request.timeoutId);
        request.typingBubble?.remove();
    }
    const button = document.querySelector("#assistantForm button[type='submit']");
    if (button) button.disabled = false;
}

function getAssistantLocalProfileKey(data = appData, petId = getActivePetKey()) {
    const savedPet = (data.pets || []).find(item => getPetKey(item) === petId) || {};
    const pet = getPetKey(data.pet) === petId ? { ...savedPet, ...data.pet } : savedPet;
    const values = (row, keys) => keys.map(key => row?.[key] ?? null);
    const own = row => String(row.petId ?? getPetKey(data.pet)) === petId;
    return JSON.stringify([
        petId, values(pet, ["name", "animal", "breed", "birthDate", "weight", "allergies", "medications", "vetClinic", "vetPhone"]),
        (pet.weightHistory || []).map(row => values(row, ["id", "date", "value"])),
        (data.healthRecords || []).filter(own).map(row => [...values(row, ["id", "name", "type", "date", "nextDate", "note"]), getAttachmentPhotos(row).length]),
        (data.reminders || []).filter(own).map(row => values(row, ["id", "name", "type", "date", "time", "repeat", "completed", "completedForDate", "note"])),
        (data.activityHistory || []).filter(own).map(row => values(row, ["id", "title", "kind", "date", "note"])),
        (data.completedTasks || []).filter(own).map(row => values(row, ["id", "date"])),
        (data.storyProjects || []).filter(own).map(row => [row.id, row.month, row.startDate, Boolean(row.collagePath), (row.photos || []).map(photo => [photo.week, photo.date])])
    ]);
}

function stopAssistantProfileLive() {
    assistantLiveGeneration += 1;
    window.clearTimeout(assistantLiveTimer);
    assistantLiveController?.abort();
    assistantLiveController = null;
    assistantLiveRefresh = null;
    assistantLiveTimer = null;
    const channel = assistantLiveChannel;
    assistantLiveChannel = null;
    if (channel) supabaseClient.removeChannel(channel).catch(() => {});
    assistantLive = { userId: null, petId: null, snapshot: null, answerContext: null, localKey: null, cloudKey: null, localDirty: false, phase: "loading", connected: false, refreshAgain: false };
}

function startAssistantProfileLive() {
    const userId = activeUserId;
    const petId = getActivePetKey();
    if (!userId || appData.pet?.isPlaceholder) { updateAssistantProfileStatus(); return; }
    if (assistantLive.userId === userId && assistantLive.petId === petId && assistantLiveChannel) {
        return;
    }
    stopAssistantProfileLive();
    const profileKey = getAssistantLocalProfileKey();
    assistantLive = { ...assistantLive, userId, petId, localKey: profileKey, cloudKey: profileKey, phase: "loading" };
    const generation = assistantLiveGeneration;
    assistantLiveChannel = supabaseClient.channel(`petcare-profile-${userId}-${generation}`)
        .on("postgres_changes", { event: "*", schema: "public", table: CLOUD_TABLE, filter: `user_id=eq.${userId}` }, payload => {
            if (activeUserId !== userId || generation !== assistantLiveGeneration) return;
            const saved = payload.new?.data;
            if (payload.new?.user_id !== userId || !saved || typeof saved !== "object") return;
            const key = getAssistantLocalProfileKey(saved, petId);
            if (key === assistantLive.cloudKey) return;
            assistantLive.cloudKey = key;
            assistantLive.answerContext = null;
            // Chat-only updates never reload the profile or delay an answer.
            scheduleAssistantProfileRefresh();
        })
        .subscribe(status => {
            if (activeUserId !== userId || generation !== assistantLiveGeneration) return;
            assistantLive.connected = status === "SUBSCRIBED";
            updateAssistantProfileStatus();
        });
    scheduleAssistantProfileRefresh(0);
    updateAssistantProfileStatus();
}

function scheduleAssistantProfileRefresh(delay = 200) {
    if (!activeUserId || assistantLive.userId !== activeUserId) return;
    window.clearTimeout(assistantLiveTimer);
    assistantLiveTimer = window.setTimeout(() => refreshAssistantProfile(), delay);
}

function notifyAssistantLocalChange(snapshot, userId) {
    if (activeUserId !== userId || assistantLive.userId !== userId || assistantLive.petId !== getActivePetKey()) return;
    const key = getAssistantLocalProfileKey(snapshot, assistantLive.petId);
    if (key !== assistantLive.localKey) {
        assistantLive.localKey = key;
        assistantLive.localDirty = true;
        assistantLive.phase = "saving";
        assistantLive.answerContext = null;
        updateAssistantProfileStatus();
    }
}

async function requestAssistantEndpoint(body, signal) {
    const userId = activeUserId;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    const session = data?.session;
    if (!userId || activeUserId !== userId || !session?.access_token || session.user?.id !== userId) throw new Error("PETCARE_AUTH_REQUIRED");
    const response = await fetch(`${SUPABASE_URL}/functions/v1/petcare-assistant`, {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal
    });
    const errorResponse = response.clone();
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const failure = new Error(payload?.code || "PETCARE_ASSISTANT_HTTP_ERROR");
        failure.context = errorResponse;
        failure.profileContext = payload?.profileContext;
        throw failure;
    }
    return payload;
}

function refreshAssistantProfile() {
    const userId = activeUserId;
    const petId = getActivePetKey();
    if (!userId || assistantLive.userId !== userId || assistantLive.petId !== petId || appData.pet?.isPlaceholder) return Promise.resolve(null);
    if (assistantLiveRefresh) { assistantLive.refreshAgain = true; return assistantLiveRefresh; }
    const generation = assistantLiveGeneration;
    const controller = new AbortController();
    assistantLiveController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    const current = () => activeUserId === userId && getActivePetKey() === petId && assistantLiveGeneration === generation;
    if (!assistantLive.localDirty) assistantLive.phase = assistantLive.snapshot ? "refreshing" : "loading";
    updateAssistantProfileStatus();
    const operation = (async () => {
        try {
            const result = await requestAssistantEndpoint({ action: "profile-status", petId }, controller.signal);
            if (!current()) return null;
            const snapshot = result?.profileContext;
            if (snapshot?.source !== "account" || String(snapshot.petId) !== petId || typeof snapshot.signature !== "string") throw new Error("PETCARE_PROFILE_MISMATCH");
            if (assistantLive.snapshot?.signature !== snapshot.signature) assistantLive.answerContext = null;
            assistantLive.snapshot = snapshot;
            assistantLive.phase = assistantLive.localDirty ? "saving" : "ready";
            return snapshot;
        } catch (error) {
            if (current()) assistantLive.phase = navigator.onLine === false ? "offline" : "error";
            return null;
        } finally {
            window.clearTimeout(timeout);
            if (current()) {
                assistantLiveRefresh = null;
                assistantLiveController = null;
                updateAssistantProfileStatus();
                if (assistantLive.refreshAgain) { assistantLive.refreshAgain = false; scheduleAssistantProfileRefresh(); }
            }
        }
    })();
    assistantLiveRefresh = operation;
    return operation;
}

function mergeAssistantMessages(remote, incoming) {
    const merged = [];
    const keys = new Set();
    [remote, incoming].forEach(list => {
        const occurrences = new Map();
        (Array.isArray(list) ? list : []).forEach(message => {
            if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") return;
            const signature = JSON.stringify([message.petId || "", message.role, message.content]);
            const occurrence = (occurrences.get(signature) || 0) + 1;
            occurrences.set(signature, occurrence);
            const key = message.id ? `id:${message.id}` : `legacy:${signature}:${occurrence}`;
            if (!keys.has(key)) { keys.add(key); merged.push(message); }
        });
    });
    return merged.slice(-30);
}

function saveAssistantConversation() {
    const userId = activeUserId;
    const account = appData;
    if (!userId) return Promise.resolve(false);
    const messages = JSON.parse(JSON.stringify(account.assistantConversation || []));
    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify(account));
    cloudSaveQueue = cloudSaveQueue.catch(() => {}).then(async () => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            if (activeUserId !== userId) return false;
            const { data: row, error } = await supabaseClient.from(CLOUD_TABLE).select("data,updated_at").eq("user_id", userId).maybeSingle();
            if (error) throw error;
            if (activeUserId !== userId) return false;
            if (!row?.data || !row.updated_at) return false;
            const merged = mergeAssistantMessages(row.data.assistantConversation, messages);
            const stamp = new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString();
            const { data: updated, error: saveError } = await supabaseClient.from(CLOUD_TABLE)
                .update({ data: { ...row.data, assistantConversation: merged }, updated_at: stamp })
                .eq("user_id", userId).eq("updated_at", row.updated_at).select("updated_at");
            if (saveError) throw saveError;
            if (updated?.length) {
                if (activeUserId === userId && appData === account) {
                    account.assistantConversation = mergeAssistantMessages(merged, account.assistantConversation);
                    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify(account));
                }
                return true;
            }
        }
        return false;
    }).catch(error => { console.error("Не удалось синхронизировать переписку:", error); return false; });
    return cloudSaveQueue;
}

function updateAssistantProfileStatus(context) {
    const status = document.getElementById("assistantProfileStatus");
    const badge = document.getElementById("assistantLiveBadge");
    if (!status) return;
    if (context?.source === "account" && String(context.petId) === getActivePetKey()) assistantLive.answerContext = context;
    const live = assistantLive;
    let text;
    let label = "Обновляю записи";
    let state = "loading";
    if (appData.pet?.isPlaceholder) {
        text = "Добавьте питомца в профиль, чтобы я мог учитывать его записи.";
        label = "Выберите питомца";
    } else if (["offline", "error"].includes(live.phase)) {
        text = live.localDirty ? "Изменения сохранены на устройстве, но ещё не синхронизированы. При восстановлении подключения записи обновятся автоматически." : "Не удалось обновить записи. Проверьте подключение; при восстановлении связи данные обновятся автоматически.";
        label = "Ожидаю подключение";
        state = "offline";
    } else if (live.localDirty || live.phase === "saving") {
        text = "Сохраняю изменения записей. Они будут учтены в следующем ответе сразу после синхронизации.";
        label = "Сохраняю записи";
    } else if (live.snapshot && live.petId === getActivePetKey()) {
        text = `Питомец: ${live.snapshot.petName}. Записей в профиле: ${live.snapshot.availableEntries}. Новые записи учитываются автоматически.`;
        if (live.answerContext?.signature === live.snapshot.signature && live.answerContext.includedEntries != null) {
            text += ` В последнем ответе учтено: ${live.answerContext.includedEntries}.${live.answerContext.partial ? " Для большой истории выбраны записи по вопросу." : ""}`;
        }
        label = live.connected ? "Записи актуальны · онлайн" : "Записи актуальны · автообновление";
        state = "ready";
    } else {
        text = `Выбран питомец: ${appData.pet?.name || "без имени"}. Получаю актуальные записи профиля…`;
    }
    if (status.textContent !== text) status.textContent = text;
    if (badge) { badge.textContent = label; badge.dataset.state = state; }
}

window.addEventListener("online", () => {
    if (assistantLive.localDirty && activeUserId) saveData();
    else scheduleAssistantProfileRefresh(0);
});
window.addEventListener("storage", event => {
    if (!activeUserId || event.key !== `${STORAGE_KEY}:${activeUserId}` || !event.newValue) return;
    try {
        const key = getAssistantLocalProfileKey(JSON.parse(event.newValue), assistantLive.petId);
        const previousKey = event.oldValue ? getAssistantLocalProfileKey(JSON.parse(event.oldValue), assistantLive.petId) : null;
        if (key !== previousKey && key !== assistantLive.cloudKey) scheduleAssistantProfileRefresh();
    } catch (_) { /* Ignore invalid or unrelated browser storage. */ }
});


function scrollAssistantToBottom(instant = false) {
    const container = document.getElementById("assistantMessages");
    if (!container) return;

    if (instant) {
        const previousBehavior = container.style.scrollBehavior;
        container.style.scrollBehavior = "auto";
        container.scrollTop = container.scrollHeight;
        requestAnimationFrame(() => {
            container.style.scrollBehavior = previousBehavior;
        });
        return;
    }

    container.scrollTop = container.scrollHeight;
}

function addAssistantBubble(role, content, scroll = true) {
    const container = document.getElementById("assistantMessages");
    if (!container) return null;

    const bubble = document.createElement("div");
    bubble.className = `assistant-message ${role === "user" ? "user-message" : "bot-message"}`;
    if (role === "assistant") {
        const sender = document.createElement("div");
        sender.className = "assistant-sender";
        sender.textContent = ASSISTANT_DISPLAY_NAME;

        const message = document.createElement("div");
        message.className = "assistant-message-content";
        message.textContent = content;
        bubble.append(sender, message);
    } else {
        bubble.textContent = content;
    }
    container.appendChild(bubble);
    if (scroll) scrollAssistantToBottom();
    return bubble;
}

function renderAssistantConversation() {
    const container = document.getElementById("assistantMessages");
    if (!container) return;

    container.replaceChildren();
    const messages = Array.isArray(appData.assistantConversation)
        ? appData.assistantConversation
        : [];

    if (messages.length === 0) {
        addAssistantBubble("assistant", `Привет! 🐾 Я ${ASSISTANT_DISPLAY_NAME}. Спроси меня о кормлении, уходе, прогулках или здоровье питомца.`, false);
        scrollAssistantToBottom(true);
        return;
    }

    messages.forEach(message => {
        if (message && (!message.petId || String(message.petId) === getActivePetKey()) && ["user", "assistant"].includes(message.role) && typeof message.content === "string") {
            addAssistantBubble(message.role, message.content, false);
        }
    });
    if (activeAssistantRequest?.phase === "waiting" && activeAssistantRequest.petId === getActivePetKey()) {
        activeAssistantRequest.typingBubble = addAssistantBubble("assistant", activeAssistantRequest.typingText, false);
    }
    scrollAssistantToBottom(true);
}

async function getAssistantErrorMessage(error) {
    console.error("PetCare assistant request failed:", error);
    const response = error?.context;
    if (response instanceof Response) {
        const payload = await response.clone().json().catch(() => null);
        if (typeof payload?.error === "string") return payload.error;
        if (response.status === 401) return "Сессия аккаунта истекла. Войдите в PetCare снова.";
        return `Сервер помощника ответил с ошибкой (HTTP ${response.status}).`;
    }

    if (error?.message === "PETCARE_AUTH_REQUIRED") {
        return "Войдите в аккаунт PetCare, чтобы пользоваться помощником.";
    }
    if (error?.message === "PETCARE_PROFILE_SYNC_FAILED") {
        return "Не удалось синхронизировать записи профиля. Проверьте подключение и попробуйте снова — для ответа нужны актуальные данные.";
    }
    if (error?.name === "AbortError") {
        return "Ответ занял слишком много времени. Попробуйте задать вопрос ещё раз.";
    }
    if (error?.name === "FunctionsFetchError" || error?.name === "TypeError") {
        return "Не удалось подключиться к серверу помощника. Проверьте интернет и попробуйте ещё раз.";
    }
    if (error?.name === "FunctionsRelayError") {
        return "Supabase не смог запустить помощника. Обновите страницу и попробуйте позже.";
    }
    return "Не удалось получить ответ PetCare ассистента. Обновите страницу и попробуйте ещё раз.";
}

async function sendAssistantMessage(event) {
    event?.preventDefault();
    const input = document.getElementById("assistantQuestion");
    const sendButton = document.querySelector("#assistantForm button[type='submit']");
    const question = input?.value.trim();
    if (!question || sendButton?.disabled || activeAssistantRequest) return;
    if (!activeUserId || appData.pet?.isPlaceholder) {
        addAssistantBubble("assistant", "Войдите в аккаунт и выберите питомца с заполненным профилем.");
        return;
    }

    const accountData = appData;
    const userId = activeUserId;
    const petId = getActivePetKey();
    const loadToken = activeDataLoadToken;
    const request = { controller: new AbortController(), timeoutId: null, typingBubble: null, phase: "waiting", petId, typingText: `${ASSISTANT_DISPLAY_NAME} отвечает…` };
    activeAssistantRequest = request;
    const isCurrent = () => activeAssistantRequest === request && activeUserId === userId
        && appData === accountData && activeDataLoadToken === loadToken && getActivePetKey() === petId;
    const conversation = Array.isArray(accountData.assistantConversation) ? accountData.assistantConversation : [];
    accountData.assistantConversation = [...conversation, { id: createEntryId("chat"), role: "user", content: question, petId, createdAt: new Date().toISOString() }].slice(-30);
    const messages = accountData.assistantConversation.filter(message => message.petId === petId && ["user", "assistant"].includes(message.role))
        .slice(-12).map(message => ({ role: message.role, content: message.content }));
    addAssistantBubble("user", question);
    input.value = "";
    if (sendButton) sendButton.disabled = true;

    const typingBubble = addAssistantBubble("assistant", request.typingText);
    request.typingBubble = typingBubble;

    try {
        request.timeoutId = window.setTimeout(() => request.controller.abort(), 85000);
        // Only a newly changed profile needs to finish saving before the question.
        if (profilePendingWrites.get(userId)) await cloudSaveQueue;
        if (!isCurrent()) return;
        if (assistantLive.localDirty && !await saveData()) throw new Error("PETCARE_PROFILE_SYNC_FAILED");
        if (!isCurrent()) return;
        saveAssistantConversation();
        const data = await requestAssistantEndpoint({ messages, petId, today: getLocalDateInputValue() }, request.controller.signal);
        if (!isCurrent()) return;
        const answer = typeof data?.answer === "string" ? data.answer.trim() : "";
        if (!answer) throw new Error(`${ASSISTANT_DISPLAY_NAME} вернул пустой ответ.`);
        if (data.profileContext && String(data.profileContext.petId) !== petId) throw new Error("PETCARE_PROFILE_MISMATCH");

        request.phase = "done";
        request.typingBubble?.remove();
        typingBubble?.remove();
        accountData.assistantConversation.push({ id: createEntryId("chat"), role: "assistant", content: answer, petId, createdAt: new Date().toISOString() });
        accountData.assistantConversation = accountData.assistantConversation.slice(-30);
        renderAssistantConversation();
        updateAssistantProfileStatus(data.profileContext);
        saveAssistantConversation().then(saved => {
            if (!saved && activeUserId === userId && appData === accountData && getActivePetKey() === petId) {
                addAssistantBubble("assistant", "Ответ сохранён на этом устройстве, но пока не синхронизирован с аккаунтом. Проверьте подключение.")?.classList.add("assistant-error");
            }
        });
    } catch (error) {
        request.phase = "done";
        request.typingBubble?.remove();
        typingBubble?.remove();
        if (!isCurrent()) return;
        const message = await getAssistantErrorMessage(error);
        if (isCurrent()) addAssistantBubble("assistant", message)?.classList.add("assistant-error");
    } finally {
        window.clearTimeout(request.timeoutId);
        if (activeAssistantRequest === request) {
            activeAssistantRequest = null;
            if (sendButton) sendButton.disabled = false;
            if (activeUserId === userId && document.getElementById("assistantPage")?.style.display === "block") input?.focus();
        }
    }
}

document.getElementById("assistantForm")?.addEventListener("submit", sendAssistantMessage);

// ==============================
// УСТАНОВКА ВЕБ-ПРИЛОЖЕНИЯ
// ==============================

// Keep event behavior in this file so the page can use a strict script CSP.
const petCareClickActions = {
    "home": () => showHome(),
    "pet": () => showPet(),
    "task-feeding": element => completeTask(element, "feeding"),
    "task-walk": element => completeTask(element, "walk"),
    "task-vitamins": element => completeTask(element, "vitamins"),
    "reminders": () => showReminders(),
    "pet-add": () => openPetForm(true),
    "pet-edit": () => openPetForm(),
    "pet-delete": () => deletePet(),
    "pet-edit-health": () => openPetForm(false, "healthPage"),
    "pet-close": () => closePetForm(),
    "pet-photo-remove": () => removePetPhoto(),
    "pet-save": () => savePet(),
    "health-close": () => closeHealthForm(),
    "health-export": () => openHealthExportDialog(),
    "health-export-print": () => exportPetHealthPdf(),
    "health-export-close": () => closeHealthExportDialog(),
    "health-export-select-all": element => setHealthExportGroup(element.dataset.exportGroup, true),
    "health-export-clear": element => setHealthExportGroup(element.dataset.exportGroup, false),
    "pet-weight-save": () => savePetWeight(),
    "health-add": () => openHealthForm(),
    "health-save": () => saveHealthRecord(),
    "health-delete": element => deleteHealthRecord(element.dataset.entryId, element.dataset.petId),
    "weight-delete": element => deleteWeightEntry(element.dataset.entryId, element.dataset.petId),
    "activity-delete": element => deleteActivityEntry(element.dataset.entryId, element.dataset.petId),
    "history-filter": () => renderEventHistory(),
    "history-open": element => openEntryHistory(element),
    "history-close": () => closeEntryHistory(),
    "history-reset": () => resetEntryHistoryFilters(),
    "calendar-previous": () => changeCalendarMonth(-1),
    "calendar-next": () => changeCalendarMonth(1),
    "reminder-add": () => openReminderForm(),
    "reminder-close": () => closeReminderForm(),
    "reminder-save": () => saveReminder(),
    "reminder-delete": element => deleteReminder(element.dataset.entryId, element.dataset.petId),
    "logout": () => logoutUser(),
    "nav-home": () => showHome(),
    "nav-pet": () => showPet(),
    "health": () => showHealth(),
    "nav-health": () => showHealth(),
    "nav-reminders": () => showReminders(),
    "nav-stories": () => showStories(),
    "push-enable": () => enablePushNotifications(),
    "push-disable": () => disablePushNotifications(),
    "story-add": () => openStorySetup(),
    "story-close": () => document.getElementById("storySetupDialog")?.close(),
    "story-create": () => createStoryPlan(),
    "story-take-photo": element => requestStoryPhoto(element),
    "story-camera": element => requestStoryPhoto(element, true),
    "story-upload-many": element => requestStoryPhoto(element, false, true),
    "story-generate": element => withStoryOperation(element.dataset.storyId, () => generatePetStoryCollage(element)),
    "story-delete": element => deleteStory(element.dataset.entryId, element.dataset.petId),
    "story-save-collage": element => withStoryOperation(element.dataset.storyId, () => saveStoryCollage(element)),
    "nav-profile": () => showProfile(),
    "nav-assistant": () => showAssistant()
};

function bindPetCareActions() {
    document.addEventListener("click", event => {
        const element = event.target instanceof Element
            ? event.target.closest("[data-pc-click]")
            : null;
        if (!element) return;

        const action = petCareClickActions[element.dataset.pcClick];
        if (!action) return;
        if (element instanceof HTMLAnchorElement) event.preventDefault();
        action(element, event);
    });

    document.addEventListener("change", event => {
        const element = event.target;
        if (!(element instanceof Element)) return;

        if (element.dataset.pcChange === "pet-switch") {
            switchPet(element.value);
        } else if (element.dataset.pcChange === "history-filter") {
            renderEventHistory();
        } else if (element.dataset.pcChange === "health-export-selection") {
            updateHealthExportSelection();
        } else if (element.id === "storyPhotoInput" || element.id === "storyCameraInput") {
            withStoryOperation(element.dataset.storyId, () => handleStoryPhotoSelection(element));
        } else if (["story-photo-date", "story-layout"].includes(element.dataset.pcChange)) {
            withStoryOperation(element.dataset.storyId, () => updateStoryCollageSetting(element));
        } else if (element.id === "storyRemindersEnabled") {
            document.getElementById("storyReminderTimeInput").disabled = !element.checked;
        }
    });

    document.addEventListener("input", event => {
        const element = event.target;
        if (element instanceof Element && element.dataset.pcInput === "history-filter") {
            renderEventHistory();
        }
    });
}

function bindAuthControls() {
    document.getElementById("loginTab")?.addEventListener("click", showLoginForm);
    document.getElementById("registerTab")?.addEventListener("click", showRegisterForm);
    document.getElementById("loginButton")?.addEventListener("click", loginUser);
    document.getElementById("registerButton")?.addEventListener("click", registerUser);
}

bindAuthControls();
bindPetCareActions();
