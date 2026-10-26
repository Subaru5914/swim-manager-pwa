/* Prepare history cleanup without changing live progress or the previous save. */
class SwimSaveHistory {
  static TRIGGER_BYTES = 15 * 1024 * 1024;
  static TARGET_BYTES = 12 * 1024 * 1024;
  static RETAIN_SEASONS = 5;
  static bytes(text) { return new TextEncoder().encode(text).length; }
  static plan(save, options = {}) {
    const trigger = options.triggerBytes ?? this.TRIGGER_BYTES;
    const target = options.targetBytes ?? this.TARGET_BYTES;
    const retain = options.retainSeasons ?? this.RETAIN_SEASONS;
    const originalText = JSON.stringify(save), beforeBytes = this.bytes(originalText);
    const unchanged = { text: originalText, beforeBytes, afterBytes: beforeBytes, removed: 0, apply() { return 0; } };
    if (beforeBytes < trigger || !Number.isInteger(save.season)) return unchanged;
    const cutoff = save.season - retain + 1;
    const records = [], references = new Map(), candidates = [], groups = new Map();
    const key = (event, time) => Number.isFinite(time) && time > 0 ? `${event}:${Math.round(time * 100)}` : null;
    const reference = (id, event, time) => {
      const value = key(event, time); if (!id || !value) return;
      if (!references.has(id)) references.set(id, new Set());
      references.get(id).add(value);
    };
    for (const book of Object.values(save.recordRankings || {})) for (const [event, rows] of Object.entries(book || {})) {
      for (const row of rows || []) records.push({ ...row, event: row.event || event });
    }
    for (const archive of Object.values(save.universityControls || {})) for (const [event, rows] of Object.entries(archive.teamTop10 || {})) for (const row of rows || []) records.push({ ...row, event: row.event || event });
    for (const [event, rows] of Object.entries(save.teamTop10 || {})) for (const row of rows || []) records.push({ ...row, event: row.event || event });
    for (const [event, row] of Object.entries(save.recordBook || {})) if (row) records.push({ ...row, event: row.event || event });
    for (const record of records) {
      reference(record.athleteId, record.event, record.time);
      for (const member of record.members || []) reference(member.id, record.event, record.time);
    }
    const old = row => Number.isInteger(row?.season) && row.season < cutoff;
    const add = (owner, field, path, allowed) => {
      const rows = owner?.[field]; if (!Array.isArray(rows)) return;
      const group = { owner, field, path, removed: new Set(), rows }; groups.set(JSON.stringify(path), group);
      rows.forEach((row, index) => {
        if (old(row) && allowed(row)) candidates.push({ group, row, index, season: row.season, slot: row.slot || 0, bytes: this.bytes(JSON.stringify(row)) + 1 });
      });
    };
    for (const field of ['players', 'world', 'retiredArchive']) for (const athlete of save[field] || []) {
      for (const [event, time] of Object.entries(athlete.bestTimes || {})) reference(athlete.id, event, time);
    }
    const protectedSnapshots = new Set((save.japanTeam?.athletes || []).map(member => member.snapshot));
    for (const field of ['players', 'world', 'retiredArchive']) for (const [i, athlete] of (save[field] || []).entries()) {
      if (protectedSnapshots.has(athlete)) continue;
      add(athlete, 'raceHistory', [field, i, 'raceHistory'], row => row.meet !== 'world_championship' && !references.get(athlete.id)?.has(key(row.event, row.time)));
    }
    add(save, 'meetHistory', ['meetHistory'], row => {
      if (row.meet === 'world_championship') return false;
      return !records.some(record => record.season === row.season && record.meet === row.meet && (record.slot == null || row.slot == null || record.slot === row.slot));
    });
    // Reputation histories, completion guards, representative archives, career
    // identities, accolades, teamPodiumHistory, teamScoreHistory and all ability/PB/training fields
    // are untouched, including medals earned by swimmers already deleted.
    candidates.sort((a, b) => a.season - b.season || a.slot - b.slot || a.index - b.index);
    let estimated = beforeBytes, removed = 0;
    for (const candidate of candidates) {
      if (estimated <= target - 1024) break;
      candidate.group.removed.add(candidate.row); estimated -= candidate.bytes; removed++;
    }
    if (!removed) return unchanged;
    const packed = JSON.parse(originalText);
    for (const group of groups.values()) if (group.removed.size) {
      let owner = packed; for (const part of group.path.slice(0, -1)) owner = owner[part];
      owner[group.field] = owner[group.field].filter((_, index) => !group.removed.has(group.rows[index]));
    }
    const report = { version: 1, season: save.season, retainSeasons: retain, removed, beforeBytes, afterBytes: 0 };
    packed.historyCleanup = report;
    let text = JSON.stringify(packed);
    report.afterBytes = this.bytes(text); text = JSON.stringify(packed);
    report.afterBytes = this.bytes(text); text = JSON.stringify(packed);
    return { text, beforeBytes, afterBytes: this.bytes(text), removed, report,
      apply(current) {
        if (current !== save) return 0;
        let count = 0;
        for (const group of groups.values()) if (group.removed.size && Array.isArray(group.owner[group.field])) {
          const rows = group.owner[group.field], next = rows.filter(row => !group.removed.has(row));
          count += rows.length - next.length; group.owner[group.field] = next;
        }
        if (count) current.historyCleanup = report;
        return count;
      }
    };
  }
}
if (typeof module !== 'undefined') module.exports = SwimSaveHistory;
