import { declareDecorator, updatable } from "./decorators";

interface GlobalState {
  buildLoading: boolean;
  deployState: "ready" | "loading" | "paused" | "cancelled";
  /**
   * An `anchor idl` write runs in the terminal. The WASM CLI reads the
   * endpoint again for each transaction, so the network must hold still.
   */
  idlWriting: boolean;
}

const defaultState: GlobalState = {
  buildLoading: false,
  deployState: "ready",
  idlWriting: false,
};

@updatable({ defaultState })
class _PgGlobal {}

export const PgGlobal = declareDecorator(_PgGlobal, {
  updatable: { defaultState },
});
