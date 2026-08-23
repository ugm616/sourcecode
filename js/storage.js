// storage.js - virtual filesystem (IndexedDB) + settings/tab persistence
"use strict";

const Store = (() => {
  const DB_NAME = "sourcecode";
  const DB_VERSION = 1;
  const FILE_STORE = "files";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FILE_STORE)) {
          db.createObjectStore(FILE_STORE, { keyPath: "path" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(FILE_STORE, mode);
      const store = t.objectStore(FILE_STORE);
      const result = fn(store);
      t.oncomplete = () => resolve(result && result._value !== undefined ? result._value : result);
      t.onerror = () => reject(t.error);
    });
  }

  function reqVal(request) {
    // helper: promisify an IDBRequest inside the current transaction
    return new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
  }

  return {
    async putFile(path, content) {
      await tx("readwrite", (s) => s.put({ path, content }));
    },
    async deleteFile(path) {
      await tx("readwrite", (s) => s.delete(path));
    },
    async getFile(path) {
      let out;
      await tx("readonly", (s) => { out = reqVal(s.get(path)); });
      const rec = await out;
      return rec ? rec.content : null;
    },
    async listFiles() {
      let out;
      await tx("readonly", (s) => { out = reqVal(s.getAll()); });
      const recs = await out;
      return recs.map((r) => ({ path: r.path, content: r.content }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    async clearFiles() {
      await tx("readwrite", (s) => s.clear());
    },

    // ---- settings (localStorage) ----
    getSettings() {
      try { return JSON.parse(localStorage.getItem("sc_settings") || "{}"); }
      catch { return {}; }
    },
    saveSettings(obj) {
      localStorage.setItem("sc_settings", JSON.stringify(obj));
    },

    // ---- tabs / session state (localStorage) ----
    getSession() {
      try { return JSON.parse(localStorage.getItem("sc_session") || "{}"); }
      catch { return {}; }
    },
    saveSession(obj) {
      try {
        localStorage.setItem("sc_session", JSON.stringify(obj));
        return true;
      } catch (e) {
        console.warn("session save failed", e);
        return false;
      }
    }
  };
})();
