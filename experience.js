(() => {
    const labels = { '🐶': 'Собака', '🐕': 'Щенок', '🐱': 'Кошка', '🐰': 'Кролик', '🐹': 'Хомяк', '🐦': 'Птица', '🦜': 'Попугай', '🐢': 'Черепаха', '🐠': 'Рыбка' };
    function setScene(element, pet) {
        if (!element) return;
        element.dataset.animal = pet?.animal || '🐶';
        element.dataset.petName = pet?.name || labels[pet?.animal] || 'Питомец';
        element.setAttribute('aria-label', `Объёмная модель: ${labels[pet?.animal] || 'питомец'}`);
        const fallback = element.querySelector('.pet-scene-fallback');
        if (fallback) fallback.textContent = pet?.animal || '🐾';
    }
    function updatePet(pet) {
        const hasPet = pet && !pet.isPlaceholder;
        document.querySelectorAll('[data-pet-scene="profile"]').forEach(element => { element.hidden = !hasPet; setScene(element, pet); });
        const title = document.getElementById('welcomeTitle');
        if (title) title.textContent = hasPet ? `${pet.name || 'Ваш питомец'} — в центре заботы` : 'Большая любовь начинается с заботы';
        const description = document.getElementById('welcomeDescription');
        if (description) description.textContent = hasPet ? 'Все маленькие дела, важные записи и счастливые моменты — в одном месте.' : 'Добавьте своего питомца. PetCare поможет собрать его историю и спланировать каждый день.';
        const action = document.getElementById('welcomeAction');
        if (action) { action.dataset.pcClick = hasPet ? 'pet' : 'pet-add'; action.textContent = hasPet ? 'Профиль питомца ↗' : 'Добавить питомца +'; }
        document.querySelectorAll('[data-selected-pet-name]').forEach(element => element.textContent = hasPet ? pet.name || 'Мой питомец' : 'Ваш будущий любимец');
        document.querySelectorAll('[data-selected-pet-type]').forEach(element => element.textContent = labels[pet?.animal] || 'Питомец');
    }
    function previewPet(pet) { document.querySelectorAll('[data-pet-scene="preview"]').forEach(element => setScene(element, pet)); }
    function updateSummary(summary) {
        for (const key of ['health', 'reminders', 'photos']) {
            const node = document.getElementById(`overview-${key}`);
            if (node) node.textContent = String(summary[key] || 0).padStart(2, '0');
        }
    }
    document.querySelectorAll('[data-demo-animal]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-demo-animal]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        setScene(document.querySelector('[data-pet-scene="demo"]'), { animal: button.dataset.demoAnimal });
    }));
    window.PetCareExperience = { updatePet, previewPet, updateSummary };
})();
