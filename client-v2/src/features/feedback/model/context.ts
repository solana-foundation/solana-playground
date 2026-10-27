import { createContext, useContext } from "react";

import { reporterFeedbackProvider } from "./provider";
import type { FeedbackProvider } from "./provider";

/** Where `FeedbackHost` sends; the build's reporter unless a test provides another */
export const FeedbackProviderContext = createContext<FeedbackProvider>(
  reporterFeedbackProvider()
);

export const useFeedbackProvider = () => useContext(FeedbackProviderContext);
