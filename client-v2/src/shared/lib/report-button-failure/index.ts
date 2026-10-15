import { createLogger } from "@/shared/lib/logger";

const log = createLogger("ui:button");

/**
 * Where a failed click goes: the `onError` of `AsyncButton` and
 * `CopyButton`, and the catch of a click path that is not one of them (such
 * as `ImportButton` and Chat's send). The failure is logged under
 * `ui:button` and not marked for reporting, because which failures reach
 * error tracking is decided in HOO-1800.
 */
export const reportButtonFailure = (error: unknown): void => log.error(error);
