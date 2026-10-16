# Настройка PetCare AI

## Supabase

1. Создайте проект Supabase и замените `your-supabase-project-ref` в `supabase/config.toml` на его project ref.
2. В Supabase SQL Editor выполните скрипт из `supabase_setup.sql`. Он создаёт таблицу пользовательских данных PetCare и политики доступа, ограничивающие чтение и запись данными текущего пользователя.
3. В настройках Edge Functions добавьте секрет `OPENAI_API_KEY`. При необходимости добавьте `OPENAI_MODEL`; функция использует модель по умолчанию, если этот секрет не задан.
4. Установите Supabase CLI, войдите командой `supabase login`, затем из корня репозитория опубликуйте функцию: `supabase functions deploy petcare-assistant`.

Не добавляйте ключи API, пароли, файлы `.env` и локальные данные Supabase в репозиторий. Frontend должен использовать только публичные параметры Supabase, а доступ к пользовательским данным защищается политиками RLS.
