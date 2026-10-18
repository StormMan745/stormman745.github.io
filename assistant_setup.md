# Подключение PetCare AI

Код чата уже находится в `index.html`, `script.js` и `supabase/functions/petcare-assistant/index.ts`. Запросы к OpenAI идут через Supabase Edge Function; API-ключ хранится только в секретах Supabase.

Если таблица `petcare_data` ещё не создана, сначала открой Supabase → **SQL Editor**, вставь содержимое `supabase_setup.sql` и нажми **Run**. Это нужно для облачного сохранения переписки.

## 1. Создать ключ OpenAI и сохранить его в Supabase

1. Открой [страницу API-ключей OpenAI](https://platform.openai.com/api-keys) и создай новый API-ключ.
2. Открой [секреты Edge Functions этого проекта Supabase](https://supabase.com/dashboard/project/qexiyikdmdbdxgusqnee/functions/secrets).
3. Добавь секрет:

- Имя: `OPENAI_API_KEY`
- Значение: созданный API-ключ

Нажми **Save**. Не вставляй ключ в `index.html`, `script.js` или другие файлы проекта и не отправляй его в чат. Для запросов API может потребоваться включённый биллинг OpenAI Platform.

## 2. Подготовить Supabase CLI для Windows

CLI уже загружен в папку `.tools\supabase` этого проекта. В PowerShell, открытом в корне проекта, проверь версию:

```powershell
& ".\.tools\supabase\supabase.exe" --version
```

Если понадобится установить CLI на другом компьютере, смотри [официальные релизы Supabase CLI](https://github.com/supabase/cli/releases/latest) и скачай архив для Windows x64.

## 3. Войти и опубликовать функцию

В PowerShell перейди в папку проекта `C:\Users\Admin\Desktop\PetCare`, затем выполни:

```powershell
& ".\.tools\supabase\supabase.exe" login
& ".\.tools\supabase\supabase.exe" functions deploy petcare-assistant --project-ref qexiyikdmdbdxgusqnee
```

Команда `login` откроет вход Supabase в браузере. После успешной публикации обнови сайт, войди в PetCare и отправь сообщение помощнику. Функция настроена требовать активную сессию Supabase.

После публикации открой сайт, войди в аккаунт и отправь сообщение в разделе «ИИ-помощник». Переписка сохраняется в данных аккаунта PetCare.
