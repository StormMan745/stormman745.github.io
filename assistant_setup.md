# Подключение PetCare AI

Чат отправляет сообщения в Supabase Edge Function `petcare-assistant`, которая отвечает через GigaChat API. Секреты авторизации хранятся только в Supabase и не передаются браузеру.

## Секреты GigaChat

В Supabase уже настроены секреты `GIGACHAT_AUTH_KEY` и `GIGACHAT_CA_CERT`. Если подключаете другую учётную запись, откройте [секреты Edge Functions](https://supabase.com/dashboard/project/qexiyikdmdbdxgusqnee/functions/secrets) и задайте:

- `GIGACHAT_AUTH_KEY` — ключ авторизации GigaChat API из личного кабинета.
- `GIGACHAT_CA_CERT` — корневой сертификат НУЦ Минцифры в PEM-формате; нужен для проверки TLS-сертификата GigaChat.
- `GIGACHAT_SCOPE` — область API, по умолчанию `GIGACHAT_API_PERS`.
- `GIGACHAT_MODEL` — модель, по умолчанию `GigaChat-2`.

Не помещайте эти значения в `index.html`, `script.js`, репозиторий или чат. Функция получает токен GigaChat на сервере и использует его для генерации ответа.

## Публикация функции из PowerShell

Из корня проекта выполните:

```powershell
& ".\.tools\supabase\supabase.exe" functions deploy petcare-assistant --project-ref qexiyikdmdbdxgusqnee
```

Функция требует активную сессию Supabase; её настройки находятся в `supabase/config.toml`. После публикации войдите в PetCare и отправьте сообщение в раздел «ИИ-помощник».

Переписка и данные питомца сохраняются в аккаунте PetCare. Ответы помощника не заменяют консультацию ветеринара.
