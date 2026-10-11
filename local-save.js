/* Keep legacy saves; use IndexedDB when a save exceeds Web Storage's quota. */
class SwimLocalSaveStore {
  constructor(options = {}) {
    this.storage = options.storage || localStorage;
    this.indexedDB = options.indexedDB || globalThis.indexedDB;
    this.key = 'swimManagerSave';
    this.marker = 'swim-manager-indexeddb-v1';
    this.databaseMode = false;
    this.pending = 0;
    this.tail = Promise.resolve();
  }
  read() {
    if (this.pending) return this.tail.catch(() => {}).then(() => this.read());
    let text;
    try { text = this.storage.getItem(this.key); }
    catch { this.databaseMode = true; }
    if (text === this.marker) this.databaseMode = true;
    if (this.databaseMode) return this.tail.catch(() => {}).then(() => this.database('readonly')).then(value => {
      if (!value) throw new Error('端末のセーブが見つかりません。クラウドから再度読み込んでください。');
      return value;
    });
    return text || this.storage.getItem('swimManagerHtmlV13');
  }
  write(text) {
    if (!this.databaseMode && !this.pending) {
      try { this.storage.setItem(this.key, text); return true; }
      catch { /* The existing save stays intact until the database commit. */ }
    }
    this.pending++;
    const operation = this.tail.catch(() => {}).then(async () => {
      await this.database('readwrite', text);
      if (!this.databaseMode) {
        // Replacing the full legacy save with a small pointer also frees space
        // for the account/session metadata used by cloud sync.
        this.storage.setItem(this.key, this.marker);
        this.databaseMode = true;
      }
      return true;
    });
    this.tail = operation;
    return operation.finally(() => { this.pending--; });
  }
  database(mode, text) {
    return new Promise((resolve, reject) => {
      if (!this.indexedDB) return reject(new Error('このブラウザでは大きなセーブを保存できません。'));
      let db, transaction, value, finished = false;
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        db?.close();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => {
        try { transaction?.abort(); } catch {}
        finish(new Error('端末保存が完了しませんでした。ゲームを開き直して再試行してください。'));
      }, 15000);
      let opening;
      try { opening = this.indexedDB.open('swim-manager-local-saves', 1); }
      catch (error) { finish(error); return; }
      opening.onupgradeneeded = () => opening.result.createObjectStore('saves');
      opening.onerror = () => finish(opening.error);
      opening.onblocked = () => finish(new Error('端末保存を開始できません。他のゲーム画面を閉じて再試行してください。'));
      opening.onsuccess = () => {
        db = opening.result;
        if (finished) { db.close(); return; }
        try {
          transaction = db.transaction('saves', mode);
          const store = transaction.objectStore('saves');
          const request = mode === 'readwrite' ? store.put(text, 'current') : store.get('current');
          request.onsuccess = () => { value = request.result; };
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish(transaction.error || new Error('端末保存が中断されました。'));
          transaction.onerror = () => {}; // onabort reports the failed transaction.
        } catch (error) { finish(error); }
      };
    });
  }
}
if (typeof module !== 'undefined') module.exports = SwimLocalSaveStore;
