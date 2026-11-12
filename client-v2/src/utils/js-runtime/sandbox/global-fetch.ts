/**
 * Makes `globalThis.fetch` a stand-in whose implementation can be set later.
 *
 * web3.js reads `globalThis.fetch` once, when its module is evaluated, and
 * keeps it. The sandbox's entry imports this module first, and it imports
 * nothing, so the stand-in is in place before any module that pulls in
 * web3.js runs; `fetch-bridge.ts` then sets what it does.
 */

/** The sandbox's own `fetch`, from its opaque origin */
export const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);

let current: typeof fetch = nativeFetch;

globalThis.fetch = (input, init) => current(input, init);

/**
 * Sets what `globalThis.fetch` does, for every caller, including the copies
 * modules took at load.
 *
 * @param implementation the new `fetch`
 */
export const setGlobalFetch = (implementation: typeof fetch) => {
  current = implementation;
};
