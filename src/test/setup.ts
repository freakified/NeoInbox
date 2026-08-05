// Dexie needs a real IndexedDB; fake-indexeddb provides one in Node. Imported
// for its side effect before any module that opens the database.
import "fake-indexeddb/auto";
