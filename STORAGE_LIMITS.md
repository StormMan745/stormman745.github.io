# Account profile storage

The application profile snapshot in `public.petcare_data.data` allows 20 MiB (20,971,520 UTF-8 bytes) by default, increased from 16 MiB. This covers records and any photos embedded in that JSON. Original documents and story files stored in Storage are separate; there is no application quota on their total size per account. Existing per-file limits remain 10 MiB for documents and 25 MiB for story files.

An administrator can set the boolean `petcare_unlimited_profile` in the selected Auth user's **server-owned `app_metadata`** to exempt that account from the snapshot byte quota. The configuration must be applied by trusted administrative tools to the verified user ID. The migration deliberately contains no email addresses or user IDs. Client profile fields, `user_metadata`, and stale/forged JWT metadata cannot grant an exemption: the database reads the authoritative `auth.users.raw_app_meta_data` row.

The private `assert_profile_payload` helper has no client execution grant. Existing authenticated own-profile and shared-care RPCs call it with the actual profile owner's ID. The existing BEFORE INSERT/UPDATE revision trigger enforces it for direct table writes and the final merged shared profile as well. JSON object validation, session checks, revisions, ownership policies and account isolation remain enforced. Backups retain the newest revision even when that one snapshot exceeds the historical 64 MiB retention budget.

The exemption removes an application quota; Supabase infrastructure, request sizes, device storage, and per-file limits still apply. It does not change the project's paid plan or billing settings. Server-side changes apply to the website and previously installed APKs without rebuilding them.

Run `tools/sql/account_profile_storage_limits.sql` with an administrative SQL connection after configuring exactly one exempt account. The probe uses temporary rows and rolls back; it does not overwrite users' saved records. It checks the exact default boundary, oversized data, the exemption, invalid JSON, forged JWT metadata, helper privileges and unauthorized RPC calls.
