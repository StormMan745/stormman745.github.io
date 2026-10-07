/* =========================
   НАВИГАЦИЯ
========================= */


function hideAllPages() {

    document.getElementById("homePage").style.display = "none";

    document.getElementById("petPage").style.display = "none";

    document.getElementById("petForm").style.display = "none";

    document.getElementById("healthPage").style.display = "none";

    document.getElementById("healthForm").style.display = "none";

    document.getElementById("remindersPage").style.display = "none";

    document.getElementById("reminderForm").style.display = "none";

    document.getElementById("profilePage").style.display = "none";

}


function showHome() {

    hideAllPages();

    document.getElementById("homePage").style.display = "block";

    document.querySelector(".bottom-menu").style.display = "flex";

}


function showPet() {

    hideAllPages();

    document.getElementById("petPage").style.display = "block";

    document.querySelector(".bottom-menu").style.display = "none";

}


function showHealth() {

    hideAllPages();

    document.getElementById("healthPage").style.display = "block";

    document.querySelector(".bottom-menu").style.display = "none";

}


function showReminders() {

    hideAllPages();

    document.getElementById("remindersPage").style.display = "block";

    document.querySelector(".bottom-menu").style.display = "none";

}


function showProfile() {

    hideAllPages();

    document.getElementById("profilePage").style.display = "block";

    document.querySelector(".bottom-menu").style.display = "none";

}


/* =========================
   ПИТОМЕЦ
========================= */


function openPetForm() {

    document.getElementById("petPage").style.display = "none";

    document.getElementById("petForm").style.display = "block";

}


function closePetForm() {

    document.getElementById("petForm").style.display = "none";

    document.getElementById("petPage").style.display = "block";

}


function savePet() {

    const name =
        document.getElementById("nameInput").value.trim();

    const breed =
        document.getElementById("breedInput").value.trim();

    const weight =
        document.getElementById("weightInput").value;

    const animal =
        document.getElementById("animalInput").value;


    if (name === "") {

        alert("Введите имя питомца!");

        return;

    }


    document.getElementById("petName").textContent = name;

    document.getElementById("petBreed").textContent =
        breed || "Порода не указана";

    document.getElementById("petWeight").textContent =
        weight ? weight + " кг" : "Не указан";

    document.getElementById("petPhoto").textContent =
        animal;


    document.getElementById("homePetName").textContent =
        name;

    document.getElementById("homePetBreed").textContent =
        breed || "Порода не указана";

    document.getElementById("homePetPhoto").textContent =
        animal;


    document.getElementById("healthPetName").textContent =
        name;


    const pet = {

        name: name,

        breed: breed,

        weight: weight,

        animal: animal

    };


    localStorage.setItem(
        "petCarePet",
        JSON.stringify(pet)
    );


    closePetForm();

}


/* =========================
   ЗАГРУЗКА ПИТОМЦА
========================= */


function loadPet() {

    const savedPet =
        localStorage.getItem("petCarePet");


    if (!savedPet) {

        return;

    }


    try {

        const pet =
            JSON.parse(savedPet);


        document.getElementById("petName").textContent =
            pet.name;

        document.getElementById("petBreed").textContent =
            pet.breed || "Порода не указана";

        document.getElementById("petWeight").textContent =
            pet.weight ? pet.weight + " кг" : "Не указан";

        document.getElementById("petPhoto").textContent =
            pet.animal;


        document.getElementById("homePetName").textContent =
            pet.name;

        document.getElementById("homePetBreed").textContent =
            pet.breed || "Порода не указана";

        document.getElementById("homePetPhoto").textContent =
            pet.animal;


        document.getElementById("healthPetName").textContent =
            pet.name;


    } catch (error) {

        console.log(
            "Не удалось загрузить данные питомца."
        );

    }

}


/* =========================
   ЗДОРОВЬЕ
========================= */


function openHealthForm() {

    document.getElementById("healthPage").style.display = "none";

    document.getElementById("healthForm").style.display = "block";

}


function closeHealthForm() {

    document.getElementById("healthForm").style.display = "none";

    document.getElementById("healthPage").style.display = "block";

}


function saveHealthRecord() {

    const type =
        document.getElementById("recordType").value;

    const name =
        document.getElementById("recordName").value.trim();

    const date =
        document.getElementById("recordDate").value;

    const note =
        document.getElementById("recordNote").value.trim();


    if (name === "") {

        alert("Введите название записи!");

        return;

    }


    const record =
        document.createElement("div");


    record.className =
        "health-record";


    record.innerHTML = `

        <div class="record-icon">
            ${type}
        </div>

        <div class="record-info">

            <h3>
                ${name}
            </h3>

            <p>
                ${date || "Дата не указана"}
            </p>

            <small>
                ${note || "Без заметки"}
            </small>

        </div>

    `;


    document
        .getElementById("healthRecords")
        .appendChild(record);


    document.getElementById("recordName").value = "";

    document.getElementById("recordDate").value = "";

    document.getElementById("recordNote").value = "";


    closeHealthForm();

}


/* =========================
   НАПОМИНАНИЯ
========================= */


function openReminderForm() {

    document.getElementById("remindersPage").style.display = "none";

    document.getElementById("reminderForm").style.display = "block";

}


function closeReminderForm() {

    document.getElementById("reminderForm").style.display = "none";

    document.getElementById("remindersPage").style.display = "block";

}


function saveReminder() {

    const type =
        document.getElementById("reminderType").value;

    const name =
        document.getElementById("reminderName").value.trim();

    const date =
        document.getElementById("reminderDate").value;

    const time =
        document.getElementById("reminderTime").value;


    if (name === "") {

        alert("Введите название напоминания!");

        return;

    }


    const reminder =
        document.createElement("div");


    reminder.className =
        "reminder";


    reminder.innerHTML = `

        <div class="reminder-icon">
            ${type}
        </div>

        <div>

            <strong>
                ${name}
            </strong>

            <p>
                ${date || "Дата не указана"}
                ${time ? ", " + time : ""}
            </p>

        </div>

    `;


    document
        .getElementById("remindersList")
        .appendChild(reminder);


    document.getElementById("reminderName").value = "";

    document.getElementById("reminderDate").value = "";

    document.getElementById("reminderTime").value = "";


    closeReminderForm();

}


/* =========================
   ЗАДАЧИ
========================= */


function completeTask(button) {

    const task =
        button.closest(".task");


    task.classList.toggle("done");


    if (task.classList.contains("done")) {

        button.textContent = "✓";

    } else {

        button.textContent = "○";

    }

}


/* =========================
   ДАТА
========================= */


function setTodayDate() {

    const date =
        new Date();


    const options = {

        day: "numeric",

        month: "long"

    };


    document.getElementById("todayDate").textContent =
        date.toLocaleDateString(
            "ru-RU",
            options
        );

}


/* =========================
   ЗАПУСК
========================= */


loadPet();

setTodayDate();

showHome();