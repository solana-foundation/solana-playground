import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { createLogger } from "./logger";

const log = createLogger("app:render");

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

/** Sends a render error to `panic` and shows `fallback` in place of the tree */
export class LoggerErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    log.panic(error, { context: { componentStack: info.componentStack } });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
