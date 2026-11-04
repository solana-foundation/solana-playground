/** What `PgCommon.sendAndReceiveCustomEvent` rejects with when the receiver fails */
export class CustomEventError extends Error {
  name = "CustomEventError";
}
