/**
 * Newer Node (25 by default, 22+ with --experimental-webstorage) defines its own
 * localStorage and sessionStorage globals. Without --localstorage-file they have
 * no methods, or throw when read, and they shadow jsdom's, so every test touching
 * storage fails ("localStorage.setItem is not a function"). Put jsdom's back.
 */
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;

const usable = (name: 'localStorage' | 'sessionStorage'): boolean => {
  try {
    return typeof globalThis[name]?.setItem === 'function';
  } catch {
    return false;
  }
};

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (jsdomWindow && !usable(name)) {
    Object.defineProperty(globalThis, name, { value: jsdomWindow[name], configurable: true, writable: true });
  }
}
