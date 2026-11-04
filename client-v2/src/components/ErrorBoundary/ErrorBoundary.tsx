import { Component, type JSX, ReactNode } from "react";
import styled, { css } from "styled-components";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type { Fn } from "../../utils";
import { Refresh } from "../Icons";
import Fallback from "./Fallback";
import ThrowError from "./ThrowError";

interface Props {
  /** Node to render as children */
  children?: ReactNode | ChildrenError;
  /** Fallback node when there is an error */
  Fallback?: (props: { error: Error }) => JSX.Element;
}

interface State {
  /** Error that was thrown */
  error: Error | null;
}

/** What a panel may hand the boundary: content, or an error to show */
export type ErrorBoundaryChildren = ReactNode | ChildrenError;

interface ChildrenError {
  /** Error that was thrown */
  error: Error;
  /** Refresh the component (need to change the `children`) */
  refresh: () => Promise<Fn | void>;
}

class ErrorBoundary extends Component<Props, State> {
  /** State of the component */
  state: State = { error: this.extractChildrenErrorProp("error") ?? null };

  /** Whether the error from props was used */
  usedErrorProp: boolean = false;

  /**
   * Extract `props.children` error props with proper type support.
   *
   * @param prop children error prop
   * @returns
   */
  extractChildrenErrorProp<P extends keyof ChildrenError>(prop: P) {
    return (this.props as { children?: ChildrenError }).children?.[prop];
  }

  /**
   * Derive the state from the given error.
   *
   * @param error error that was thrown
   * @returns the state
   */
  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { error };
  }

  /** Render `fallback` if there is an error, `children` otherwise. */
  render() {
    const error = this.extractChildrenErrorProp("error");
    if (error && !this.usedErrorProp) {
      this.usedErrorProp = true;
      this.setState((s) => ({ ...s, error }));
      return null;
    }

    if (this.state.error) {
      const FbComponent = this.props.Fallback ?? Fallback;
      const FbElement = <FbComponent error={this.state.error} />;

      // Reset the state (without the error) in order to re-render
      const refresh = () => this.setState((s) => ({ ...s, error: null }));

      if (this.props.Fallback) {
        return (
          <Wrapper iconOnly>
            {FbElement}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh"
                  onClick={refresh}
                >
                  <Refresh color="error" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </Wrapper>
        );
      }

      return (
        <Wrapper>
          {FbElement}

          <Button variant="ghost" onClick={refresh}>
            <Refresh data-icon="inline-start" />
            Refresh
          </Button>
        </Wrapper>
      );
    }

    const refresh = this.extractChildrenErrorProp("refresh");
    if (refresh) return <ThrowError refresh={refresh} />;

    // Reset the error prop usage so that we can show the error next time
    this.usedErrorProp = false;

    // An error object never reaches here: the branches above handle it
    return this.props.children as ReactNode;
  }
}

const Wrapper = styled.div<{ iconOnly?: boolean }>`
  ${({ iconOnly }) => css`
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: ${iconOnly ? "row-reverse" : "column"};
    gap: ${iconOnly ? "0.25rem" : "1rem"};
  `}
`;

export default ErrorBoundary;
