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
    completedTasks: []
};


// ==============================
// СОХРАНЕНИЕ ДАННЫХ
// ==============================

function saveData() {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(appData)
    );
}


// ==============================
// ЗАГРУЗКА ДАННЫХ
// ==============================

function loadData() {
    const savedData = localStorage.getItem(STORAGE_KEY);

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

function saveHealthRecord() {
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

    saveData();
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

function saveReminder() {
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

    saveData();
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

function completeTask(element, taskName) {
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

    saveData();
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

    loadData();
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
        const homePage = document.getElementById("homePage");
        const bottomMenu = document.querySelector(".bottom-menu");

        if (authPage) authPage.style.display = "block";
        if (homePage) homePage.style.display = "none";
        if (bottomMenu) bottomMenu.style.display = "none";

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
        const homePage = document.getElementById("homePage");
        const bottomMenu = document.querySelector(".bottom-menu");

        if (authPage) authPage.style.display = "block";
        if (homePage) homePage.style.display = "none";
        if (bottomMenu) bottomMenu.style.display = "none";

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

   
}

startApp();
