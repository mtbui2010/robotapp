// A preference that belongs to ONE browser tab (the language the operator picked) but is remembered for new tabs.
//
// localStorage is shared by every tab of the browser: when a tab keeps the language only in localStorage, picking EN in one tab changes
// what any other tab reads the next time it (re)loads or hot-reloads, so a Korean session turned English by itself. Each tab now keeps its
// own choice in sessionStorage (it survives a reload of that tab, not other tabs); localStorage only holds the LAST choice as the default
// for a tab that has none yet.
const get = (s: () => Storage, key: string): string | null => { try { return s().getItem(key) } catch { return null } }
const put = (s: () => Storage, key: string, v: string) => { try { s().setItem(key, v) } catch { /* no storage */ } }

export const readTabPref = (key: string, legacyKey?: string): string | null =>
  get(() => sessionStorage, key) ?? get(() => localStorage, key) ?? (legacyKey ? get(() => localStorage, legacyKey) : null)

// A tab that has not chosen yet keeps what it started with: without this a reload would read the last choice of ANOTHER tab.
export const pinTabPref = (key: string, effective: string): void => {
  if (get(() => sessionStorage, key) === null) put(() => sessionStorage, key, effective)
}

export const writeTabPref = (key: string, v: string): void => {
  put(() => sessionStorage, key, v)      // this tab
  put(() => localStorage, key, v)        // the default of the next new tab
}
