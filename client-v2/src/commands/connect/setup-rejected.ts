/** What `connect` rejects with when the user closes the wallet setup */
export const SETUP_REJECTED = "Setup rejected.";

/** Whether a failed `connect` was the user dismissing the setup, not a fault */
export const isSetupRejected = (error: unknown) =>
  error instanceof Error && error.message === SETUP_REJECTED;
