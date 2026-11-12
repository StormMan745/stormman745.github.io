-- Reviewed transcription stays with private document metadata, outside AI context.
alter table public.petcare_documents
    add column extracted_text text not null default ''
    check (length(extracted_text) <= 50000);
grant update (extracted_text) on public.petcare_documents to authenticated;
