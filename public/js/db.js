/* IndexedDB wrapper para cache offline */
const ChatDB = (() => {
  let db = null;
  const DB_NAME = 'chat-app-db';
  const DB_VERSION = 1;

  async function open() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;

        // messages store
        if (!database.objectStoreNames.contains('messages')) {
          const msgStore = database.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('conversation_id', 'conversation_id', { unique: false });
          msgStore.createIndex('created_at', 'created_at', { unique: false });
          msgStore.createIndex('conv_created', ['conversation_id', 'created_at'], { unique: false });
        }

        // conversations store
        if (!database.objectStoreNames.contains('conversations')) {
          database.createObjectStore('conversations', { keyPath: 'id' });
        }

        // users store
        if (!database.objectStoreNames.contains('users')) {
          database.createObjectStore('users', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => { console.error('IndexedDB error:', e); reject(e); };
    });
  }

  function getStore(storeName, mode = 'readonly') {
    const tx = db.transaction([storeName], mode);
    return tx.objectStore(storeName);
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveMessages(msgs) {
    if (!db || !msgs || !msgs.length) return;
    const tx = db.transaction(['messages'], 'readwrite');
    const store = tx.objectStore('messages');
    for (const msg of msgs) {
      store.put(msg);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getMessages(conversationId, limit = 50) {
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('conversation_id');
      const req = index.getAll(IDBKeyRange.only(conversationId));
      req.onsuccess = () => {
        const all = (req.result || [])
          .filter(m => !m.deleted)
          .sort((a, b) => a.created_at - b.created_at);
        resolve(all.slice(-limit));
      };
      req.onerror = () => { console.warn('getMessages error', req.error); resolve([]); };
    });
  }

  async function saveConversations(convs) {
    if (!db || !convs || !convs.length) return;
    const tx = db.transaction(['conversations'], 'readwrite');
    const store = tx.objectStore('conversations');
    for (const conv of convs) {
      store.put(conv);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getConversations() {
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['conversations'], 'readonly');
      const store = tx.objectStore('conversations');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => { console.warn('getConversations error'); resolve([]); };
    });
  }

  async function saveConversation(conv) {
    if (!db || !conv) return;
    const tx = db.transaction(['conversations'], 'readwrite');
    const store = tx.objectStore('conversations');
    store.put(conv);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateConversationLastMsg(convId, msg) {
    if (!db) return;
    const tx = db.transaction(['conversations'], 'readwrite');
    const store = tx.objectStore('conversations');
    const req = store.get(convId);
    req.onsuccess = () => {
      const conv = req.result;
      if (conv) {
        conv.last_message = msg;
        store.put(conv);
      }
    };
    return new Promise((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  }

  async function saveUsers(users) {
    if (!db || !users || !users.length) return;
    const tx = db.transaction(['users'], 'readwrite');
    const store = tx.objectStore('users');
    for (const user of users) {
      store.put(user);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clear() {
    if (!db) return;
    const stores = ['messages', 'conversations', 'users'];
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach(s => tx.objectStore(s).clear());
    return new Promise((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  }

  return { open, saveMessages, getMessages, saveConversations, getConversations, saveConversation, updateConversationLastMsg, saveUsers, clear };
})();

window.ChatDB = ChatDB;
