// @ts-check
// `.mjs` so `scripts/public-env.mjs` can import it from Node, and the browser parser in `widgets/observability` too.

/** A plain decimal from 0 to 1, `.5` included; `Number()` alone would also take `0x1` and `1e-1` */
export const SAMPLE_RATE = /^(?:0|0\.\d*|\.\d+|1|1\.0*)$/;
