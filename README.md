
# PetCare

Уход за питомцами: медицинские записи и оригиналы документов, напоминания, курсы лекарств, коллажи, совместный уход и помощник с контекстом выбранного питомца.

Сайт: https://stormman745.github.io/

- [Офлайн-работа, совместный уход, экспорт и восстановление](CARE_PLATFORM.md)
- [Документы и печать](documents_setup.md)
- [Защита и ограничения](security.md)
- [Настройка помощника](assistant_setup.md)
- [Клиники и карты](clinics_setup.md)

Клиент — статические HTML/CSS/JavaScript; сервер — Supabase Auth, PostgreSQL, Storage и Edge Functions. Секреты сервера остаются в Supabase Secrets/Vault. Для локальной разработки удобнее HTTP-сервер; Service Worker и установка требуют HTTPS или localhost.

Проверки серверных обработчиков: `npm ci --prefix tools`, затем `npm run --prefix tools test:security`. Полные проверки офлайн-сценариев и печати: `npm run --prefix tools test:care` (требуются Chrome и Playwright, пути описаны в CARE_PLATFORM.md).
