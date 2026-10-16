// ==============================
// SUPABASE
// ==============================

const SUPABASE_URL = "https://qexiyikdmdbdxgusqnee.supabase.co";
const SUPABASE_KEY = "sb_publishable_HSR87zEuGFNjwEYoa-zrSw_cTWchorw";

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

let appData = {
    pet: {
        name: "Барни",
        breed: "Золотистый ретривер",
        weight: "28",
        animal: "🐶",
        dbId: null
    },
    healthRecords: [],
    reminders: [],
    completedTasks: [],
    assistantConversation: []
};


// ==============================
// СОХРАНЕНИЕ ДАННЫХ
// ==============================

function saveData() {
    localStorage.setItem(
        activeUserId ? `${STORAGE_KEY}:${activeUserId}` : STORAGE_KEY,
        JSON.stringify(appData)
    );

    if (!activeUserId) return Promise.resolve();

    const userId = activeUserId;
    const snapshot = JSON.parse(JSON.stringify(appData));
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
        })
        .catch(error => {
            console.error("Не удалось сохранить данные в Supabase. Локальная копия сохранена:", error);
        });

    return cloudSaveQueue;
}


// ==============================
// ЗАГРУЗКА ДАННЫХ
// ==============================

function loadData() {
    const savedData = localStorage.getItem(
        activeUserId ? `${STORAGE_KEY}:${activeUserId}` : STORAGE_KEY
    );

    if (!savedData) {
        return;
    }

    try {
        const parsedData = JSON.parse(savedData);

        appData = {
            ...appData,
            ...parsedData
        };
    } catch (error) {
        console.error("Ошибка загрузки данных:", error);
    }
}

async function loadDataFromDatabase(userId) {
    activeUserId = userId;
    const userStorageKey = `${STORAGE_KEY}:${userId}`;
    const legacyData = localStorage.getItem(userStorageKey)
        ? null
        : localStorage.getItem(STORAGE_KEY);
    const savedData = localStorage.getItem(userStorageKey) || legacyData;

    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            appData = {
                ...appData,
                ...parsed,
                pet: { ...appData.pet, ...(parsed.pet || {}) },
                healthRecords: Array.isArray(parsed.healthRecords) ? parsed.healthRecords : [],
                reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
                completedTasks: Array.isArray(parsed.completedTasks) ? parsed.completedTasks : [],
                assistantConversation: Array.isArray(parsed.assistantConversation) ? parsed.assistantConversation : []
            };
        } catch (error) {
            console.error("Не удалось прочитать локальную копию данных:", error);
        }
    }

    const { data, error } = await supabaseClient
        .from(CLOUD_TABLE)
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        console.error("Не удалось загрузить данные из Supabase; используется локальная копия:", error);
    } else if (data && data.data) {
        const cloudData = data.data;
        appData = {
            ...appData,
            ...cloudData,
            pet: { ...appData.pet, ...(cloudData.pet || {}) },
            healthRecords: Array.isArray(cloudData.healthRecords) ? cloudData.healthRecords : [],
            reminders: Array.isArray(cloudData.reminders) ? cloudData.reminders : [],
            completedTasks: Array.isArray(cloudData.completedTasks) ? cloudData.completedTasks : [],
            assistantConversation: Array.isArray(cloudData.assistantConversation) ? cloudData.assistantConversation : []
        };
    } else if (savedData) {
        // First sign-in after the upgrade: migrate this browser's saved data to the account.
        await saveData();
    }

    localStorage.setItem(userStorageKey, JSON.stringify(appData));
    if (legacyData) localStorage.removeItem(STORAGE_KEY);
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

    renderHealthRecords();
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

function openPetForm() {
    hideAllPages();

    const petForm = document.getElementById("petForm");

    if (petForm) {
        petForm.style.display = "block";
    }

    fillPetForm();
}


function closePetForm() {
    showPet();
}


function fillPetForm() {
    const nameInput = document.getElementById("nameInput");
    const breedInput = document.getElementById("breedInput");
    const weightInput = document.getElementById("weightInput");
    const animalInput = document.getElementById("animalInput");

    if (nameInput) {
        nameInput.value = appData.pet.name || "";
    }

    if (breedInput) {
        breedInput.value = appData.pet.breed || "";
    }

    if (weightInput) {
        weightInput.value = appData.pet.weight || "";
    }

    if (animalInput) {
        animalInput.value = appData.pet.animal || "🐶";
    }
}


// ==============================
// СОХРАНЕНИЕ ПИТОМЦА
// ==============================

async function savePet() {
    const nameInput = document.getElementById("nameInput");
    const breedInput = document.getElementById("breedInput");
    const weightInput = document.getElementById("weightInput");
    const animalInput = document.getElementById("animalInput");

    const name = nameInput ? nameInput.value.trim() : "";
    const breed = breedInput ? breedInput.value.trim() : "";
    const weight = weightInput ? weightInput.value : "";
    const animal = animalInput ? animalInput.value : "🐶";

    if (!name) {
        alert("Введите имя питомца!");
        return;
    }

    const { data: userData, error: userError } =
    await supabaseClient.auth.getUser();

if (userError || !userData.user) {
    alert("Сначала войдите в аккаунт!");
    return;
}

const petData = {
    name,
    breed,
    weight: weight ? Number(weight) : null,
    animal,
    user_id: userData.user.id
};

    try {
        let result;

        if (appData.pet && appData.pet.dbId) {
            result = await supabaseClient
                .from("pets")
                .update(petData)
                .eq("id", appData.pet.dbId)
                .eq("user_id", userData.user.id)
                .select()
                .maybeSingle();
        } else {
            result = await supabaseClient
                .from("pets")
                .insert(petData)
                .select()
                .maybeSingle();
        }

        if (result.error) {
            console.error(
                "Ошибка сохранения питомца в Supabase:",
                result.error
            );

            appData.pet = {
                ...(appData.pet || {}),
                ...petData,
                dbId: appData.pet ? appData.pet.dbId : null
            };

            saveData();
            updatePetOnScreen();
            closePetForm();

            alert(
                "Данные обновлены на этом устройстве, но не сохранены в облаке. Ошибка Supabase: " +
                result.error.message
            );

            return;
        }

        if (!result.data) {
            console.warn(
                "Supabase не вернул запись после сохранения. Проверьте RLS-политики таблицы pets."
            );

            appData.pet = {
                ...(appData.pet || {}),
                ...petData,
                dbId: appData.pet ? appData.pet.dbId : null
            };

            saveData();
            updatePetOnScreen();
            closePetForm();

            alert(
                "Данные обновлены на этом устройстве, но Supabase не вернул запись. Проверьте права доступа (RLS) таблицы pets."
            );

            return;
        }

        appData.pet = {
            ...petData,
            dbId: result.data.id
        };

        saveData();
        updatePetOnScreen();
        closePetForm();

        alert("Питомец сохранён! 🐾");

    } catch (error) {
        console.error("Ошибка сохранения питомца:", error);

        alert(
            "Не удалось сохранить данные. Подробности смотри в консоли браузера (F12 → Console)."
        );
    }
}


// ==============================
// ОБНОВЛЕНИЕ ПИТОМЦА НА ЭКРАНЕ
// ==============================

function updatePetOnScreen() {
    const pet = appData.pet || {};

    const name = pet.name || "Барни";
    const breed = pet.breed || "Порода не указана";
    const animal = pet.animal || "🐶";
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

    if (photoElement) photoElement.textContent = animal;

    const homeName = document.getElementById("homePetName");
    const homeBreed = document.getElementById("homePetBreed");
    const homePhoto = document.getElementById("homePetPhoto");

    if (homeName) homeName.textContent = name;
    if (homeBreed) homeBreed.textContent = breed;
    if (homePhoto) homePhoto.textContent = animal;

    const healthName = document.getElementById("healthPetName");

    if (healthName) {
        healthName.textContent = name;
    }
}


// ==============================
// ЗАГРУЗКА ПИТОМЦА ИЗ SUPABASE
// ==============================

async function loadPetFromDatabase() {
    try {
        const { data: userData, error: userError } =
            await supabaseClient.auth.getUser();

        if (userError || !userData.user) {
            console.error("Пользователь не авторизован.");
            return;
        }

        const result = await supabaseClient
            .from("pets")
            .select("*")
            .eq("user_id", userData.user.id)
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (result.error) {
            console.error("Ошибка загрузки питомца:", result.error);
            return;
        }

        if (result.data) {
            appData.pet = {
                name: result.data.name || "Барни",
                breed: result.data.breed || "",
                weight: result.data.weight ?? "",
                animal: result.data.animal || "🐶",
                dbId: result.data.id
            };

            saveData();
            updatePetOnScreen();
        }
    } catch (error) {
        console.error("Ошибка загрузки питомца:", error);
    }
}

 

// ==============================
// ЗДОРОВЬЕ — ФОРМА
// ==============================

function openHealthForm() {
    hideAllPages();

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
    const type = document.getElementById("recordType").value;
    const name = document.getElementById("recordName").value.trim();
    const date = document.getElementById("recordDate").value;
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
        note: note
    };

    appData.healthRecords.push(record);

    await saveData();
    addHealthRecordToScreen(record);
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

    recordElement.innerHTML = `
        <div class="record-icon">
            ${icon}
        </div>

        <div class="record-info">
            <strong>${record.name}</strong>

            <small>
                ${record.date || "Дата не указана"}
            </small>

            ${
                record.note
                    ? `<small>${record.note}</small>`
                    : ""
            }
        </div>
    `;

    container.appendChild(recordElement);
}


// ==============================
// ПОКАЗАТЬ ВСЕ ЗАПИСИ ЗДОРОВЬЯ
// ==============================

function renderHealthRecords() {
    const container = document.getElementById("healthRecords");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (
        !appData.healthRecords ||
        appData.healthRecords.length === 0
    ) {
        container.innerHTML = `
            <p style="text-align:center;color:#888;">
                Пока нет записей
            </p>
        `;

        return;
    }

    appData.healthRecords.forEach(record => {
        addHealthRecordToScreen(record);
    });
}


// ==============================
// НАПОМИНАНИЯ — ФОРМА
// ==============================

function openReminderForm() {
    hideAllPages();

    const reminderForm = document.getElementById("reminderForm");

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
    const type = document.getElementById("reminderType").value;
    const name = document.getElementById("reminderName").value.trim();
    const date = document.getElementById("reminderDate").value;
    const time = document.getElementById("reminderTime").value;

    if (name === "") {
        alert("Введите название напоминания!");
        return;
    }

    const reminder = {
        id: Date.now(),
        type: type,
        name: name,
        date: date,
        time: time
    };

    appData.reminders.push(reminder);

    await saveData();
    addReminderToScreen(reminder);
    closeReminderForm();
}


// ==============================
// ДОБАВИТЬ НАПОМИНАНИЕ НА ЭКРАН
// ==============================

function addReminderToScreen(reminder) {
    const container = document.getElementById("remindersList");

    if (!container) {
        return;
    }

    const reminderElement = document.createElement("div");
    reminderElement.className = "reminder";

    let icon = "🔔";

    if (reminder.type === "Кормление") {
        icon = "🍖";
    }

    if (reminder.type === "Прогулка") {
        icon = "🚶";
    }

    if (reminder.type === "Лекарство") {
        icon = "💊";
    }

    if (reminder.type === "Ветеринар") {
        icon = "🩺";
    }

    reminderElement.innerHTML = `
        <div class="reminder-icon">
            ${icon}
        </div>

        <div class="record-info">
            <strong>${reminder.name}</strong>

            <small>
                ${reminder.date || ""}
                ${reminder.time || ""}
            </small>
        </div>
    `;

    container.appendChild(reminderElement);
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

    if (
        !appData.reminders ||
        appData.reminders.length === 0
    ) {
        container.innerHTML = `
            <p style="text-align:center;color:#888;">
                Пока нет напоминаний
            </p>
        `;

        return;
    }

    appData.reminders.forEach(reminder => {
        addReminderToScreen(reminder);
    });
}


// ==============================
// ЗАДАЧИ НА ГЛАВНОЙ
// ==============================

async function completeTask(element, taskName) {
    if (!element) {
        return;
    }

    element.classList.toggle("done");

    if (element.classList.contains("done")) {
        if (!appData.completedTasks.includes(taskName)) {
            appData.completedTasks.push(taskName);
        }
    } else {
        appData.completedTasks = appData.completedTasks.filter(
            task => task !== taskName
        );
    }

    await saveData();
}


// ==============================
// ВОССТАНОВИТЬ ВЫПОЛНЕННЫЕ ЗАДАЧИ
// ==============================

function restoreTasks() {
    const tasks = document.querySelectorAll(".task");

    tasks.forEach(task => {
        const taskName = task.getAttribute("data-task");

        if (
            taskName &&
            appData.completedTasks.includes(taskName)
        ) {
            task.classList.add("done");
        }
    });
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
    const homePage = document.getElementById("homePage");
    const bottomMenu = document.querySelector(".bottom-menu");

    if (authPage) authPage.style.display = "none";
    if (homePage) homePage.style.display = "block";
    if (bottomMenu) bottomMenu.style.display = "flex";

    const { data: authData, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !authData.user) {
        console.error("Не удалось определить пользователя для загрузки данных:", authError);
        return;
    }

    await loadDataFromDatabase(authData.user.id);
    setTodayDate();
    updatePetOnScreen();
    renderHealthRecords();
    renderReminders();
    restoreTasks();

    await loadPetFromDatabase();
    await loadUserProfile();

    showHome();
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

        activeUserId = null;
        showLoginForm();
    } catch (error) {
        console.error("Ошибка выхода:", error);
        alert("Не удалось выйти из аккаунта.");
    }
}


// ==============================
// ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
// ==============================

async function loadUserProfile() {
    try {
        const { data, error } = await supabaseClient.auth.getUser();

        if (error || !data.user) {
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

        activeUserId = null;
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

startApp();
function showAssistant() {
    hideAllPages();
    const assistantPage = document.getElementById("assistantPage");

    if (assistantPage) assistantPage.style.display = "block";

    renderAssistantConversation();
}

function addAssistantBubble(role, content) {
    const container = document.getElementById("assistantMessages");
    if (!container) return null;

    const bubble = document.createElement("div");
    bubble.className = `assistant-message ${role === "user" ? "user-message" : "bot-message"}`;
    bubble.textContent = content;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
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
        addAssistantBubble("assistant", "Привет! 🐾 Я PetCare AI. Спроси меня об уходе за питомцем.");
        return;
    }

    messages.forEach(message => {
        if (message && ["user", "assistant"].includes(message.role) && typeof message.content === "string") {
            addAssistantBubble(message.role, message.content);
        }
    });
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

    const typingBubble = addAssistantBubble("assistant", "Думаю над ответом…");
    saveData();

    try {
        const pet = appData.pet || {};
        const { data, error } = await supabaseClient.functions.invoke("petcare-assistant", {
            body: {
                messages: appData.assistantConversation.slice(-12),
                pet: {
                    name: String(pet.name || "").slice(0, 80),
                    breed: String(pet.breed || "").slice(0, 100),
                    animal: String(pet.animal || "").slice(0, 40),
                    weight: String(pet.weight || "").slice(0, 20)
                }
            }
        });

        if (error) {
            let detail = error.message || "Не удалось связаться с ИИ-помощником.";
            if (error.name === "FunctionsFetchError" || detail.includes("Failed to send a request")) {
                detail = "Supabase не смог достучаться до функции petcare-assistant. Возможно, функция ещё не опубликована или соединение блокирует CORS/сеть.";
            }
            try {
                const response = error.context;
                if (response && typeof response.json === "function") {
                    const body = await response.json();
                    if (body.error) detail = body.error;
                }
            } catch (_) {}
            throw new Error(detail);
        }

        if (!data || typeof data.answer !== "string" || !data.answer.trim()) {
            throw new Error("Помощник вернул пустой ответ. Попробуй ещё раз.");
        }

        appData.assistantConversation.push({ role: "assistant", content: data.answer.trim() });
        appData.assistantConversation = appData.assistantConversation.slice(-30);
        renderAssistantConversation();
        await saveData();
    } catch (error) {
        typingBubble?.remove();
        addAssistantBubble(
            "assistant",
            `Не получилось получить ответ: ${error.message} Проверь, что функция PetCare AI опубликована и в Supabase добавлен ключ OpenAI.`
        )?.classList.add("assistant-error");
    } finally {
        if (sendButton) sendButton.disabled = false;
        input?.focus();
    }
}

document.getElementById("assistantForm")?.addEventListener("submit", sendAssistantMessage);
