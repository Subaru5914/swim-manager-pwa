/* Email/password authentication and private saves via the Firebase REST APIs. */
class SwimCloudSync {
  constructor(options) {
    this.options = options;
    this.storage = options.storage || localStorage;
    this.request = options.fetch || ((...args) => fetch(...args));
    this.config = null;
    this.session = null;
    this.meta = {};
    this.conflict = null;
    this.cleanText = null;
    this.busy = false;
    this.epoch = 0;
    this.status = { kind: 'unconfigured', text: 'クラウド未設定' };
  }
  read(key) { try { return JSON.parse(this.storage.getItem(key)); } catch { return null; } }
  write(key, value) { this.storage.setItem(key, JSON.stringify(value)); }
  notify(kind, text) {
    this.status = { kind, text };
    this.options.onStatus?.(this.status);
  }
  static configuration(value) {
    if (!value?.apiKey || !value?.databaseURL) return null;
    const url = new URL(value.databaseURL);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.(firebaseio\.com|(?:[a-z0-9-]+\.)?firebasedatabase\.app)$/.test(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw new Error('Firebase Realtime DatabaseのHTTPS URLを指定してください。');
    }
    return { apiKey: String(value.apiKey).trim(), databaseURL: url.origin };
  }
  async start(defaults) {
    try {
      this.config = SwimCloudSync.configuration(defaults) || SwimCloudSync.configuration(this.read('swimManagerCloudConfig'));
      if (!this.config) return this.notify('unconfigured', 'クラウド未設定');
      const session = this.read('swimManagerCloudSession');
      if (session?.databaseURL === this.config.databaseURL && session?.refreshToken && session?.uid) {
        this.session = session;
        this.meta = this.read(this.metaKey()) || {};
        await this.sync();
      } else this.notify('signed-out', 'クラウド：未ログイン');
    } catch (error) { this.notify('error', error.message); }
    if (!this.interval) this.interval = setInterval(() => this.sync(), 15000);
  }
  async configure(value) {
    const config = SwimCloudSync.configuration(value);
    if (!config) throw new Error('apiKeyとdatabaseURLを入力してください。');
    this.logout();
    this.write('swimManagerCloudConfig', config);
    await this.start(config);
  }
  metaKey() { return `swimManagerCloudMeta:${this.config.databaseURL}:${this.session.uid}`; }
  persistMeta() { if (this.session) this.write(this.metaKey(), this.meta); }
  saveSession() { this.write('swimManagerCloudSession', { ...this.session, databaseURL: this.config.databaseURL }); }
  async jsonRequest(url, options) {
    const response = await this.request(url, { ...options, signal: AbortSignal.timeout(20000) });
    const value = await response.json();
    if (!response.ok) {
      const code = value?.error?.message || value?.error || '';
      const messages = {
        EMAIL_EXISTS: 'このメールアドレスは登録済みです。ログインしてください。',
        INVALID_EMAIL: 'メールアドレスを確認してください。',
        INVALID_LOGIN_CREDENTIALS: 'メールアドレスかパスワードが違います。',
        EMAIL_NOT_FOUND: 'メールアドレスかパスワードが違います。',
        INVALID_PASSWORD: 'メールアドレスかパスワードが違います。',
        OPERATION_NOT_ALLOWED: 'Firebaseでメール／パスワードの認証を有効にしてください。',
        API_KEY_INVALID: 'FirebaseのapiKeyを確認してください。',
        TOO_MANY_ATTEMPTS_TRY_LATER: '時間をおいてからログインしてください。',
        USER_DISABLED: 'このアカウントは無効になっています。'
      };
      const error = new Error(messages[code] || (String(code).startsWith('WEAK_PASSWORD') ? 'パスワードは6文字以上にしてください。' : 'クラウドに接続できません。Firebaseの設定と接続を確認してください。'));
      error.status = response.status;
      throw error;
    }
    return value;
  }
  async login(email, password, create = false) {
    if (!this.config) throw new Error('先にクラウド設定を保存してください。');
    const epoch = ++this.epoch;
    const value = await this.jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:${create ? 'signUp' : 'signInWithPassword'}?key=${encodeURIComponent(this.config.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    if (epoch !== this.epoch) return;
    this.session = { uid: value.localId, email: value.email || email, idToken: value.idToken, refreshToken: value.refreshToken, expiresAt: Date.now() + Number(value.expiresIn) * 1000 };
    this.meta = this.read(this.metaKey()) || {};
    this.conflict = null;
    this.saveSession();
    this.notify('pending', 'クラウドを確認中');
    await this.sync();
  }
  logout() {
    ++this.epoch;
    clearTimeout(this.timer);
    this.session = null;
    this.conflict = null;
    this.meta = {};
    this.cleanText = null;
    this.storage.removeItem('swimManagerCloudSession');
    this.notify(this.config ? 'signed-out' : 'unconfigured', this.config ? 'クラウド：未ログイン' : 'クラウド未設定');
  }
  async token() {
    if (this.session.expiresAt > Date.now() + 60000) return this.session.idToken;
    const epoch = this.epoch;
    try {
      const value = await this.jsonRequest(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.config.apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.session.refreshToken }).toString()
      });
      if (epoch !== this.epoch) throw new Error('アカウントが変更されました。');
      Object.assign(this.session, { idToken: value.id_token, refreshToken: value.refresh_token, expiresAt: Date.now() + Number(value.expires_in) * 1000 });
      this.saveSession();
      return this.session.idToken;
    } catch (error) {
      if (epoch === this.epoch && error.status === 400) {
        this.logout();
        throw new Error('ログインの期限が切れました。もう一度ログインしてください。');
      }
      throw error;
    }
  }
  async database(suffix = '', options = {}) {
    const session = this.session, config = this.config;
    const token = await this.token();
    if (session !== this.session || config !== this.config) throw new Error('アカウントが変更されました。');
    return this.request(`${config.databaseURL}/swimManagerSaves/${encodeURIComponent(session.uid)}${suffix}.json?auth=${encodeURIComponent(token)}`, { ...options, signal: AbortSignal.timeout(20000) });
  }
  async remote() {
    const response = await this.database('', { headers: { 'X-Firebase-ETag': 'true' } });
    if (!response.ok) throw new Error('クラウドの保存先にアクセスできません。Databaseのルールを確認してください。');
    const etag = response.headers.get('ETag');
    if (!etag) throw new Error('保存先から更新情報を取得できません。');
    return { value: await response.json(), etag };
  }
  static async fingerprint(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  static validSave(value) {
    return value && !Array.isArray(value) && Array.isArray(value.players) && value.players.length > 0 && Array.isArray(value.world) && Number.isInteger(value.season) && Number.isInteger(value.slot) && value.slot >= 1 && value.slot <= 96 && Number.isFinite(value.points) && Number.isFinite(value.reputation) && value.facilities && value.players.every(player => player.id && player.stats && player.bestTimes);
  }
  static async encode(text) {
    if (new TextEncoder().encode(text).length > 20 * 1024 * 1024) throw new Error('セーブが大きすぎます。セーブ書出でバックアップしてください。');
    if (typeof CompressionStream === 'undefined') return { encoding: 'json', payload: text };
    const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return { encoding: 'gzip-base64', payload: btoa(binary) };
  }
  static async decode(value) {
    if (value?.schemaVersion !== 1 || typeof value.payload !== 'string' || typeof value.revision !== 'string' || typeof value.fingerprint !== 'string') throw new Error('クラウドのセーブ形式を読み込めません。');
    let text;
    if (value.encoding === 'json') text = value.payload;
    else if (value.encoding === 'gzip-base64') {
      if (typeof DecompressionStream === 'undefined') throw new Error('圧縮セーブを読むため、Safariやブラウザを更新してください。');
      const bytes = Uint8Array.from(atob(value.payload), char => char.charCodeAt(0));
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('クラウドのセーブが大きすぎます。'); }
        chunks.push(part.value);
      }
      text = await new Blob(chunks).text();
    } else throw new Error('クラウドのセーブ形式を読み込めません。');
    if (await SwimCloudSync.fingerprint(text) !== value.fingerprint) throw new Error('クラウドのセーブが破損しています。');
    const parsed = JSON.parse(text);
    if (!SwimCloudSync.validSave(parsed)) throw new Error('クラウドのゲームデータが不正です。');
    return parsed;
  }
  changed() {
    if (!this.session) return;
    this.meta.dirty = true;
    try { this.persistMeta(); } catch { this.notify('error', '同期情報を端末へ保存できません。'); return; }
    if (this.conflict) return;
    this.notify('pending', 'クラウド：同期待ち');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 1500);
  }
  setConflict(remote) {
    this.conflict = remote;
    this.meta.dirty = true;
    this.persistMeta();
    this.notify('conflict', 'クラウド：使用するセーブを選択');
  }
  async applyRemote(remote, epoch, before) {
    const save = await SwimCloudSync.decode(remote.value);
    if (epoch !== this.epoch) return;
    if (this.options.getSave() !== before || !this.options.canApply()) return this.setConflict(remote);
    await this.options.applySave(save);
    if (epoch !== this.epoch) return;
    const text = this.options.getSave(), fingerprint = await SwimCloudSync.fingerprint(text);
    if (epoch !== this.epoch) return;
    this.cleanText = text;
    this.meta = { revision: remote.value.revision, fingerprint, dirty: false, syncedAt: Date.now() };
    this.conflict = null;
    this.persistMeta();
    this.notify('synced', 'クラウド：同期済み');
  }
  async upload(remote, epoch) {
    const text = this.options.getSave(), save = JSON.parse(text), fingerprint = await SwimCloudSync.fingerprint(text);
    if (!SwimCloudSync.validSave(save)) throw new Error('端末のゲームデータを保存できません。');
    const packed = await SwimCloudSync.encode(text);
    if (packed.payload.length > 12 * 1024 * 1024) throw new Error('クラウドに保存できるサイズを超えています。');
    const value = { schemaVersion: 1, revision: crypto.randomUUID(), fingerprint, ...packed, updatedAt: { '.sv': 'timestamp' }, season: save.season, slot: save.slot, university: save.playerUniversity || '' };
    if (epoch !== this.epoch) return;
    const response = await this.database('', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': remote.etag }, body: JSON.stringify(value) });
    if (epoch !== this.epoch) return;
    if (response.status === 412) {
      const updated = await this.remote();
      if (epoch === this.epoch) this.setConflict(updated);
      return;
    }
    if (!response.ok) throw new Error('クラウドに保存できません。接続とDatabaseのルールを確認してください。');
    this.meta = { revision: value.revision, fingerprint, dirty: this.options.getSave() !== text, syncedAt: Date.now() };
    this.cleanText = text;
    this.conflict = null;
    this.persistMeta();
    this.notify(this.meta.dirty ? 'pending' : 'synced', this.meta.dirty ? 'クラウド：同期待ち' : 'クラウド：同期済み');
  }
  async sync() {
    if (!this.config || !this.session || this.conflict) return;
    if (this.busy) { this.resync = true; return; }
    if (!this.options.online() || !this.options.canApply()) return this.notify('pending', 'クラウド：同期待ち');
    this.busy = true;
    const epoch = this.epoch;
    try {
      const before = this.options.getSave(), fingerprint = await SwimCloudSync.fingerprint(before);
      this.meta.dirty = fingerprint !== this.meta.fingerprint;
      if (!this.meta.dirty) this.cleanText = before;
      if (!this.meta.dirty && this.meta.revision) {
        const response = await this.database('/revision');
        if (!response.ok) throw new Error('クラウドの更新を確認できません。');
        const revision = await response.json();
        if (epoch !== this.epoch) return;
        if (revision === this.meta.revision) return this.notify('synced', 'クラウド：同期済み');
      }
      const remote = await this.remote();
      if (epoch !== this.epoch) return;
      if (!remote.value) await this.upload(remote, epoch);
      else if (remote.value.revision === this.meta.revision) {
        if (this.meta.dirty) await this.upload(remote, epoch);
        else this.notify('synced', 'クラウド：同期済み');
      } else if (remote.value.fingerprint === fingerprint) {
        await SwimCloudSync.decode(remote.value);
        if (epoch !== this.epoch) return;
        this.meta = { revision: remote.value.revision, fingerprint, dirty: false, syncedAt: Date.now() };
        this.cleanText = before;
        this.persistMeta();
        this.notify('synced', 'クラウド：同期済み');
      } else if (this.meta.revision && !this.meta.dirty) await this.applyRemote(remote, epoch, before);
      else this.setConflict(remote);
    } catch (error) { if (epoch === this.epoch) this.notify('error', error.message || '接続が戻ると再び同期します。'); }
    finally {
      this.busy = false;
      if (epoch === this.epoch && this.session && !this.conflict) {
        const changed = this.status.kind === 'synced' && this.options.getSave() !== this.cleanText;
        if (changed) {
          this.meta.dirty = true;
          this.persistMeta();
          this.notify('pending', 'クラウド：同期待ち');
        }
        if (changed || this.resync || this.meta.dirty && this.status.kind === 'pending') {
          this.resync = false;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.sync(), 500);
        }
      }
    }
  }
  async resolve(choice) {
    if (!this.conflict || this.busy || !this.session) return;
    if (!this.options.online()) throw new Error('オンラインに戻ってから選択してください。');
    this.busy = true;
    const epoch = this.epoch;
    try {
      const remote = await this.remote();
      if (epoch !== this.epoch) return;
      if (remote.value?.revision !== this.conflict.value?.revision) {
        this.setConflict(remote);
        throw new Error('他の端末で更新されました。もう一度、使用するセーブを選んでください。');
      }
      if (choice === 'local') await this.upload(remote, epoch);
      else if (choice === 'remote' && remote.value) await this.applyRemote(remote, epoch, this.options.getSave());
    } finally { this.busy = false; }
  }
  stop() { clearInterval(this.interval); clearTimeout(this.timer); ++this.epoch; }
}
if (typeof module !== 'undefined' && module.exports) module.exports = SwimCloudSync;
else window.SwimCloudSync = SwimCloudSync;
