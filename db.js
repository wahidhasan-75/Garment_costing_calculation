/* =========================================================
   IndexedDB layer (no external libs)
   - Stores product + computed results + compressed image blob
   - Stores 1 in-progress draft (to survive refresh)
   ========================================================= */

(() => {
  'use strict';

  const DB_NAME = 'garment-costing-db';
  const DB_VERSION = 2;

  const STORE_PRODUCTS = 'products';
  const STORE_DRAFTS = 'drafts';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
          const store = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('styleName', 'styleName', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
          db.createObjectStore(STORE_DRAFTS, { keyPath: 'id' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const res = fn(store);

      tx.oncomplete = () => resolve(res);
      tx.onerror = () => reject(tx.error || tx.transaction?.error);
      tx.onabort = () => reject(tx.error || tx.transaction?.error);
    });
  }

  // ---------- Products ----------
  function putProduct(product) {
    return withStore(STORE_PRODUCTS, 'readwrite', (store) => store.put(product));
  }

  function deleteProduct(id) {
    return withStore(STORE_PRODUCTS, 'readwrite', (store) => store.delete(id));
  }

  function getProduct(id) {
    return withStore(STORE_PRODUCTS, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function getAllProducts() {
    return withStore(STORE_PRODUCTS, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          // newest first
          items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  function bulkPut(products) {
    return withStore(STORE_PRODUCTS, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        let i = 0;
        function next() {
          if (i >= products.length) return resolve(true);
          const req = store.put(products[i]);
          req.onsuccess = () => { i += 1; next(); };
          req.onerror = () => reject(req.error);
        }
        next();
      });
    });
  }

  // ---------- Drafts ----------
  function putDraft(draft) {
    return withStore(STORE_DRAFTS, 'readwrite', (store) => store.put(draft));
  }

  function getDraft(id) {
    return withStore(STORE_DRAFTS, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function clearDraft(id) {
    return withStore(STORE_DRAFTS, 'readwrite', (store) => store.delete(id));
  }

  window.GCDB = {
    openDB,
    // products
    putProduct,
    deleteProduct,
    getProduct,
    getAllProducts,
    bulkPut,
    // drafts
    putDraft,
    getDraft,
    clearDraft,
  };
})();
