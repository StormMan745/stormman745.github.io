Warning: truncated output (original token count: 35535)
Total output lines: 3514

// ==============================
// SUPABASE
// ==============================

const SUPABASE_URL = "https://qexiyikdmdbdxgusqnee.supabase.co";
const SUPABASE_KEY = "sb_publishable_HSR87zEuGFNjwEYoa-zrSw_cTWchorw";
const STORY_STORAGE_BUCKET = "petcare-stories";
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
const storyVideoBlobCache = new Map();

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

function resetActiveAccountData() {
    activeDataLoadToken += 1;
    activeUserId = null;
    appData = createInitialAppData();
}

function getPetKey(pet) {
    return String(pet?.dbId ?? pet?.id ?? "legacy-default");
}

function getActivePetKey() {
    return getPetKey(appData.pet);
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
        petId: record.petId == null ? legacyPetId : String(record.petId)
    }));
    appData.reminders = appData.reminders.map(reminder => ({
        ...reminder,
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

    const userId = activeUserId;
    const snapshot = JSON.parse(JSON.stringify(appData));
    const activePhotoRecord = snapshot.pets?.find(pet =>
        getPetKey(pet) === getPetKey(snapshot.pet)
    );
    if (activePhotoRecord?.photoData && snapshot.pet) {
        delete snapshot.pet.photoData;
    }

    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify(snapshot));

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
}


// ==============================
// ГЛАВНАЯ
// ==============================

function showHome() {
    hideAllPages();

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
    const page = document.getElementById("storiesPage");
    if (page) page.style.display = "block";
    renderStories();
}


// ==============================
// ПРОФИЛЬ
// ==============================

function showProfile() {
    hideAllPages();

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


function compressPetPhoto(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Не удалось прочитать файл фотографии."));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("Не удалось открыть изображение."));
            image.onload = () => {
                const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
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
                resolve(canvas.toDataURL("image/jpeg", 0.78));
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
        story.videoPath,
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
            storyVideoBlobCache.delete(path);
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
    await saveData();
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
                weight: row.weight ?? savedPet.weight ?? "",
                animal: row.animal || savedPet.animal || "🐶",
                photoData: savedPet.photoData || null
            };
        });
        const databaseIds = new Set(loadedPets.map(pet => String(pet.dbId)));
        const localOnlyPets = appData.pets.filter(pet => {
            return pet.dbId == null && !databaseIds.has(getPetKey(pet)) && !isDefaultPlaceholder(pet);
        });
        appData.pets = [...loadedPets, ...localOnlyPets];

        const selectedPet = appData.pets.find(pet => getPetKey(pet) === String…15535 tokens truncated…   masterGain.gain.value = 0.33;
    masterGain.connect(destination);
    const baseTime = audioContext.currentTime + 0.15;
    const melody = [
        523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.00, 698.46,
        523.25, 659.25, 783.99, 1046.50, 880.00, 783.99, 659.25, 587.33,
        523.25, 587.33, 659.25, 783.99, 698.46, 659.25, 587.33, 523.25,
        587.33, 698.46, 783.99, 880.00, 783.99, 698.46, 659.25, 523.25,
        587.33, 659.25
    ];
    melody.forEach((frequency, index) => {
        scheduleStoryNote(audioContext, masterGain, frequency, baseTime + index * 0.4, 0.48, 0.16, "triangle");
    });
    const chords = [
        [130.81, 164.81, 196.00],
        [110.00, 130.81, 164.81],
        [87.31, 130.81, 174.61],
        [98.00, 146.83, 196.00]
    ];
    const slideDuration = 3400;
    chords.forEach((chord, slideIndex) => {
        chord.forEach(frequency => {
            scheduleStoryNote(
                audioContext,
                masterGain,
                frequency,
                baseTime + slideIndex * slideDuration / 1000,
                slideDuration / 1000,
                0.09,
                "sine"
            );
        });
    });

    const canvasStream = canvas.captureStream(24);
    const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
    ]);
    const mimeCandidates = [
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
    ];
    const mimeType = mimeCandidates.find(type => window.MediaRecorder.isTypeSupported?.(type));
    let recorder;
    try {
        recorder = mimeType
            ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1600000, audioBitsPerSecond: 128000 })
            : new MediaRecorder(stream, { videoBitsPerSecond: 1600000, audioBitsPerSecond: 128000 });
    } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error("Этот браузер не поддерживает подходящий формат видео.");
    }

    const monthLabel = formatStoryMonth(story.month);
    const petName = appData.pet?.name || "Ваш питомец";
    const totalDuration = slideDuration * images.length;
    const recordedBlob = await new Promise((resolve, reject) => {
        const chunks = [];
        let animationId = 0;
        recorder.ondataavailable = event => {
            if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = event => {
            cancelAnimationFrame(animationId);
            reject(event.error || new Error("Не удалось записать видео."));
        };
        recorder.onstop = () => {
            cancelAnimationFrame(animationId);
            resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }));
        };
        recorder.start(500);

        const startedAt = performance.now();
        const drawFrame = now => {
            const elapsed = now - startedAt;
            const slideIndex = Math.min(images.length - 1, Math.floor(elapsed / slideDuration));
            const withinSlide = elapsed - slideIndex * slideDuration;
            const progress = Math.min(1, withinSlide / slideDuration);
            context.fillStyle = "#203b2b";
            context.fillRect(0, 0, canvas.width, canvas.height);
            drawStoryCover(context, canvas, images[slideIndex].image, progress);
            if (slideIndex < images.length - 1 && withinSlide > slideDuration - 350) {
                context.save();
                context.globalAlpha = Math.min(1, (withinSlide - slideDuration + 350) / 350);
                drawStoryCover(context, canvas, images[slideIndex + 1].image, 0);
                context.restore();
            }

            const shade = context.createLinearGradient(0, 720, 0, canvas.height);
            shade.addColorStop(0, "rgba(12, 31, 21, 0)");
            shade.addColorStop(1, "rgba(12, 31, 21, 0.82)");
            context.fillStyle = shade;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = "rgba(255,255,255,0.9)";
            context.font = "600 24px system-ui, sans-serif";
            context.fillText("PETCARE  ·  ИСТОРИЯ МЕСЯЦА", 42, 76);
            context.fillStyle = "#fff";
            context.font = "700 54px system-ui, sans-serif";
            context.fillText(petName.slice(0, 22), 42, 1090);
            context.font = "500 29px system-ui, sans-serif";
            context.fillText("Неделя " + (slideIndex + 1) + "  ·  " + monthLabel, 44, 1142);
            context.fillStyle = "rgba(255,255,255,0.78)";
            context.font = "500 22px system-ui, sans-serif";
            context.fillText("Маленькие моменты, которые остаются", 44, 1200);

            const percentage = Math.min(99, Math.round(elapsed / totalDuration * 100));
            onProgress("Собираю видео… " + percentage + "%");
            if (elapsed >= totalDuration) {
                onProgress("Сохраняю готовый ролик…");
                if (recorder.state !== "inactive") recorder.stop();
            } else {
                animationId = requestAnimationFrame(drawFrame);
            }
        };
        animationId = requestAnimationFrame(drawFrame);
    });

    stream.getTracks().forEach(track => track.stop());
    if (!recordedBlob.size) throw new Error("Видео получилось пустым. Попробуйте собрать историю ещё раз.");
    return recordedBlob;
}

async function generatePetStoryVideo(button) {
    const story = appData.storyProjects.find(item =>
        item.id === button?.dataset.storyId && String(item.petId) === getActivePetKey()
    );
    if (!story) return;
    const orderedPhotos = [1, 2, 3, 4].map(week =>
        (story.photos || []).find(photo => Number(photo.week) === week && photo.path)
    );
    if (orderedPhotos.some(photo => !photo)) {
        alert("Добавьте по одному фото для каждой из четырёх недель.");
        return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
        alert("Создание видео не поддерживается этим браузером. Попробуйте открыть PetCare в актуальном Safari или Chrome.");
        return;
    }

    button.disabled = true;
    const originalLabel = button.textContent;
    let audioContext;
    let loadedImages = [];
    try {
        audioContext = new AudioContextClass();
        await audioContext.resume();
        setStoryStatus(story.id, "Подготавливаю фотографии…");
        loadedImages = await Promise.all(orderedPhotos.map(photo => loadStoryImage(photo.path)));
        const videoBlob = await recordPetStoryVideo(
            loadedImages,
            story,
            audioContext,
            message => {
                button.textContent = message;
                setStoryStatus(story.id, message);
            }
        );
        const videoType = videoBlob.type.includes("mp4") ? "video/mp4" : "video/webm";
        const extension = videoType === "video/mp4" ? "mp4" : "webm";
        const videoPath = activeUserId + "/" + story.id + "/story-" + Date.now() + "." + extension;
        const { error } = await supabaseClient.storage
            .from(STORY_STORAGE_BUCKET)
            .upload(videoPath, videoBlob, {
                cacheControl: "3600",
                contentType: videoType,
                upsert: false
            });
        if (error) throw error;

        const oldVideoPath = story.videoPath;
        story.videoPath = videoPath;
        story.videoType = videoType;
        story.videoCreatedAt = new Date().toISOString();
        storyMediaUrlCache.set(videoPath, { url: URL.createObjectURL(videoBlob), expiresAt: Number.MAX_SAFE_INTEGER });
        storyVideoBlobCache.set(videoPath, videoBlob);
        const synced = await saveData();
        if (oldVideoPath) {
            const { error: removeError } = await supabaseClient.storage
                .from(STORY_STORAGE_BUCKET)
                .remove([oldVideoPath]);
            if (removeError) console.warn("Не удалось удалить старое видео истории:", removeError);
            storyMediaUrlCache.delete(oldVideoPath);
            storyVideoBlobCache.delete(oldVideoPath);
        }
        renderStories();
        if (!synced) alert("Видео создано, но историю не удалось синхронизировать с аккаунтом. Проверьте подключение.");
    } catch (error) {
        console.error("Не удалось собрать видеоисторию:", error);
        setStoryStatus(story.id, error?.message || "Не удалось собрать видео. Попробуйте ещё раз.");
        alert(error?.message || "Не удалось собрать видео. Проверьте подключение и повторите попытку.");
    } finally {
        loadedImages.forEach(item => URL.revokeObjectURL(item.objectUrl));
        if (audioContext && audioContext.state !== "closed") await audioContext.close().catch(() => {});
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

function triggerStoryVideoDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function saveStoryVideo(button) {
    const story = appData.storyProjects.find(item =>
        item.id === button?.dataset.storyId && String(item.petId) === getActivePetKey()
    );
    if (!story?.videoPath) return;
    const extension = story.videoType === "video/mp4" ? "mp4" : "webm";
    const filename = "PetCare-" + story.month + "." + extension;

    try {
        let videoBlob = storyVideoBlobCache.get(story.videoPath);
        if (!videoBlob) {
            const { data, error } = await supabaseClient.storage
                .from(STORY_STORAGE_BUCKET)
                .download(story.videoPath);
            if (error || !data) throw error || new Error("Не удалось загрузить сохранённое видео.");
            videoBlob = data;
            storyVideoBlobCache.set(story.videoPath, videoBlob);
        }
        const type = story.videoType || videoBlob.type || "video/webm";
        const file = new File([videoBlob], filename, { type });
        const shareData = { files: [file], title: "История " + formatStoryMonth(story.month) };
        const canShareFile = navigator.share && navigator.canShare?.(shareData);
        if (canShareFile) {
            try {
                await navigator.share(shareData);
                return;
            } catch (error) {
                if (error?.name === "AbortError") return;
                if (error?.name !== "NotAllowedError") throw error;
            }
        }
        triggerStoryVideoDownload(videoBlob, filename);
        alert("Видео скачано. На телефоне откройте файл и выберите сохранение в галерею или Фото.");
    } catch (error) {
        console.error("Не удалось сохранить видеоисторию:", error);
        alert("Не удалось подготовить видео к сохранению. Попробуйте ещё раз.");
    }
}


// ==============================
// ЗАДАЧИ НА ГЛАВНОЙ
// ==============================

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
            if (authPage) authPage.style.display = "block";
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

    if (authPage) authPage.style.display = "block";
    if (homePage) homePage.style.display = "none";
    if (bottomMenu) bottomMenu.style.display = "none";

    showLoginForm();
    await checkAuth();
}

document.getElementById("petPhotoInput")?.addEventListener("change", handlePetPhotoSelection);
document.getElementById("recordPhotoInput")?.addEventListener("change", event => queueAttachmentPhotoSelection(event, "health"));
document.getElementById("reminderPhotoInput")?.addEventListener("change", event => queueAttachmentPhotoSelection(event, "reminder"));
document.getElementById("animalInput")?.addEventListener("change", event => {
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
    const assistantPage = document.getElementById("assistantPage");

    if (assistantPage) assistantPage.style.display = "block";

    renderAssistantConversation();
}

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
    bubble.textContent = content;
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
        addAssistantBubble("assistant", "Привет! 🐾 Я бесплатный помощник PetCare. Спроси меня о кормлении, уходе, прогулках или здоровье питомца.", false);
        scrollAssistantToBottom(true);
        return;
    }

    messages.forEach(message => {
        if (message && ["user", "assistant"].includes(message.role) && typeof message.content === "string") {
            addAssistantBubble(message.role, message.content, false);
        }
    });
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
    if (error?.name === "FunctionsFetchError" || error?.name === "TypeError") {
        return "Не удалось подключиться к серверу помощника. Проверьте интернет и попробуйте ещё раз.";
    }
    if (error?.name === "FunctionsRelayError") {
        return "Supabase не смог запустить помощника. Обновите страницу и попробуйте позже.";
    }
    return "Не удалось получить ответ GigaChat. Обновите страницу и попробуйте ещё раз.";
}

async function sendAssistantMessage(event) {
    event?.preventDefault();
    const input = document.getElementById("assistantQuestion");
    const sendButton = document.querySelector("#assistantForm button[type='submit']");
    const question = input?.value.trim();
    if (!question || sendButton?.disabled) return;

    const conversation = Array.isArray(appData.assistantConversation)
        ? appData.assistantConversation
        : [];
    appData.assistantConversation = conversation;
    conversation.push({ role: "user", content: question });
    appData.assistantConversation = conversation.slice(-30);
    addAssistantBubble("user", question);
    input.value = "";
    if (sendButton) sendButton.disabled = true;

    const typingBubble = addAssistantBubble("assistant", "GigaChat готовит ответ…");

    try {
        const { data: authData, error: authError } = await supabaseClient.auth.getSession();
        if (authError) throw authError;
        const accessToken = authData?.session?.access_token;
        if (!accessToken) throw new Error("PETCARE_AUTH_REQUIRED");

        const activePet = appData.pet || {};
        const { data, error } = await supabaseClient.functions.invoke("petcare-assistant", {
            body: {
                messages: appData.assistantConversation.slice(-12),
                pet: {
                    name: activePet.name,
                    breed: activePet.breed,
                    animal: activePet.animal,
                    weight: activePet.weight
                }
            },
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (error) throw error;
        const answer = typeof data?.answer === "string" ? data.answer.trim() : "";
        if (!answer) throw new Error("GigaChat вернул пустой ответ.");

        typingBubble?.remove();
        appData.assistantConversation.push({ role: "assistant", content: answer });
        appData.assistantConversation = appData.assistantConversation.slice(-30);
        renderAssistantConversation();
        await saveData();
    } catch (error) {
        typingBubble?.remove();
        appData.assistantConversation.pop();
        addAssistantBubble("assistant", await getAssistantErrorMessage(error))?.classList.add("assistant-error");
    } finally {
        if (sendButton) sendButton.disabled = false;
        input?.focus();
    }
}

document.getElementById("assistantForm")?.addEventListener("submit", sendAssistantMessage);

// ==============================
// УСТАНОВКА ВЕБ-ПРИЛОЖЕНИЯ
// ==============================

let deferredInstallPrompt = null;

function isPetCareInstalled() {
    return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isAppleMobileDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function showInstallButtons() {
    document.querySelectorAll(".install-app-button").forEach(button => {
        button.hidden = false;
    });
}

function openInstallHelp(platform) {
    const dialog = document.getElementById("installHelpDialog");
    const text = document.getElementById("installHelpText");
    const steps = document.getElementById("installHelpSteps");
    if (!dialog || !text || !steps) return;

    if (platform === "installed") {
        text.textContent = "PetCare уже установлен на этом устройстве. Откройте его с главного экрана или из списка приложений.";
        steps.replaceChildren();
    } else if (platform === "ios") {
        text.textContent = "Добавьте PetCare на главный экран, чтобы открывать его как обычное приложение.";
        steps.replaceChildren();
        [
            "Откройте сайт в Safari на iPhone или iPad.",
            "Нажмите кнопку «Поделиться» внизу экрана.",
            "Выберите «На экран Домой», затем нажмите «Добавить»."
        ].forEach(step => {
            const item = document.createElement("li");
            item.textContent = step;
            steps.appendChild(item);
        });
    } else {
        text.textContent = "Установите PetCare из меню браузера, чтобы запускать сайт в отдельном окне.";
        steps.replaceChildren();
        [
            "Откройте сайт в Chrome или другом поддерживаемом браузере.",
            "Нажмите меню браузера ⋮.",
            "Выберите «Установить приложение» или «Добавить на главный экран»."
        ].forEach(step => {
            const item = document.createElement("li");
            item.textContent = step;
            steps.appendChild(item);
        });
    }

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
}

function closeInstallHelp() {
    const dialog = document.getElementById("installHelpDialog");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
}

async function installPetCareApp() {
    if (isPetCareInstalled()) {
        openInstallHelp("installed");
        return;
    }

    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        return;
    }

    openInstallHelp(isAppleMobileDevice() ? "ios" : "android");
}

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    showInstallButtons();
});

if (isPetCareInstalled()) {
    showInstallButtons();
}

if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(error => {
            console.error("Не удалось включить офлайн-оболочку PetCare:", error);
        });
    }, { once: true });
}

// Keep event behavior in this file so the page can use a strict script CSP.
const petCareClickActions = {
    "install": () => installPetCareApp(),
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
    "health-export": () => exportPetHealthPdf(),
    "pet-weight-save": () => savePetWeight(),
    "health-add": () => openHealthForm(),
    "health-save": () => saveHealthRecord(),
    "history-filter": () => renderEventHistory(),
    "calendar-previous": () => changeCalendarMonth(-1),
    "calendar-next": () => changeCalendarMonth(1),
    "reminder-add": () => openReminderForm(),
    "reminder-close": () => closeReminderForm(),
    "reminder-save": () => saveReminder(),
    "install-close": () => closeInstallHelp(),
    "logout": () => logoutUser(),
    "auth-login": () => showLoginForm(),
    "auth-register": () => showRegisterForm(),
    "login": () => loginUser(),
    "register": () => registerUser(),
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
    "story-generate": element => generatePetStoryVideo(element),
    "story-save-video": element => saveStoryVideo(element),
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
        } else if (element.id === "storyPhotoInput") {
            handleStoryPhotoSelection(element);
        }
    });

    document.addEventListener("input", event => {
        const element = event.target;
        if (element instanceof Element && element.dataset.pcInput === "history-filter") {
            renderEventHistory();
        }
    });
}

bindPetCareActions();

