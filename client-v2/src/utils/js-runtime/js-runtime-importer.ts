export class PgJsRuntimeImporter {
  /** Asynchronously import `PgJsRuntime`, which loads the TypeScript compiler */
  static async import() {
    return await import("./js-runtime");
  }
}
