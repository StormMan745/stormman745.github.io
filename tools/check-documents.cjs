// Document persistence now uses the same real SDK/IndexedDB regression harness as
// offline care. The old stub assumed immediate uploads and permanent deletion.
// Printing is independently covered by check-document-print.cjs.
require('./check-offline-care.cjs');
