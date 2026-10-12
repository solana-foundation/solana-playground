import { useEffect, useState } from "react";
import styled, { css, keyframes } from "styled-components";

import IdlActions from "./IdlActions";
import { parseBuildReport } from "./build-report";
import type { BuildDiagnostic, BuildReport } from "./build-report";
import { isRestoredBuild, ownOutput } from "./build-surface";
import { humanize } from "./humanize";
import Button from "../../../components/Button";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import GradientButton from "../../../components/GradientButton";
import { PgAssistant } from "../../sidebar/assistant/store";
import { PgFlow } from "../state/stage";
import type { FlowState } from "../state/stage";
import {
  PgCommand,
  PgExplorer,
  PgFramework,
  PgSettings,
  PgTheme,
} from "../../../utils";

/** `flow.buildMs` as a ` - 3.2s` suffix, or nothing while it is unknown */
const msSuffix = (ms: number | null) =>
  ms === null ? "" : ` - ${(ms / 1000).toFixed(1)}s`;

/**
 * The build server's host, for naming it in the UI. Falls back to the raw
 * setting: the value is parsed as a URL when it is set, but this also runs
 * on the surface that reports an unreachable server, where throwing would
 * replace the diagnosis with a blank stage.
 */
const serverHost = () => {
  const endpoint = PgSettings.server.endpoint;
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
};

/** `flow.buildMs` as a plain `2.9s`, or `null` while it is unknown */
const msLabel = (ms: number | null) =>
  ms === null ? null : `${(ms / 1000).toFixed(1)}s`;

/**
 * The text rustc prints after the last run of `^` on a diagnostic's marker
 * line, e.g. `` expected `u64`, found `&str` `` -- with the backticks
 * stripped, since this is rendered as plain text, not markdown.
 */
const extractLabel = (excerpt: string): string | null => {
  const match = excerpt.match(/\^+\s*(.+)$/m);
  return match ? match[1].replace(/`/g, "") : null;
};

interface SourceLine {
  num: number;
  text: string;
  failing: boolean;
}

/**
 * The real source lines surrounding a diagnostic (`line - 1` through
 * `line + 1`), read live from the explorer. `null` when the file or line is
 * missing, or the file cannot be read -- callers fall back to rustc's own
 * gutter excerpt in that case.
 */
const readSourceLines = (d: BuildDiagnostic): SourceLine[] | null => {
  if (!d.file || !d.line) return null;
  const content = PgExplorer.getFileContent(d.file);
  if (!content) return null;

  const all = content.split("\n");
  const lines: SourceLine[] = [];
  for (let n = d.line - 1; n <= d.line + 1; n++) {
    if (n < 1 || n > all.length) continue;
    lines.push({ num: n, text: all[n - 1], failing: n === d.line });
  }
  return lines.length ? lines : null;
};

const Build = () => {
  const [out, setOut] = useState<BuildOutput | null>(null);
  const [flow, setFlow] = useState<FlowState>(PgFlow.state);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const a = PgBuildOutput.onDidChange(setOut);
    const b = PgFlow.onDidChange(setFlow);
    return () => {
      a.dispose();
      b.dispose();
    };
  }, []);

  const ms = msSuffix(flow.buildMs);
  const building = flow.build === "running";
  // The surface is chosen by the last *settled* status, never by
  // "running": an unreachable build server fails in milliseconds, and
  // swapping surfaces for that round trip reads as a blink (failed ->
  // building -> failed). While a run is in flight the previous surface
  // stays put and only its action shows "Building...".
  const settled = building ? flow.buildSettled : flow.build;

  // `PgBuildOutput` keeps one value for the whole session, so a report from
  // the project opened before this one is still sitting in `out`. Anything
  // another workspace recorded is not this surface's to show.
  const own = ownOutput(out, PgExplorer.currentWorkspaceName ?? null);

  // `out` only fills in once a build reaches the compiler and returns; a
  // build that fails before that (e.g. the build server is unreachable)
  // still flips `flow.build` to "failed", but `out` stays `null` or, if a
  // previous run left one behind, goes stale.
  const outIsStale =
    own !== null &&
    flow.buildStartedAt !== null &&
    own.at < flow.buildStartedAt;

  // The workspace's own record outlived the page; the compiler's words did
  // not. Say what is known and no more -- the branches below would either
  // offer a first build over a finished one, or blame a build server for a
  // failure whose cause this page never saw.
  if (isRestoredBuild(settled, own, flow.buildStartedAt)) {
    const failed = settled === "failed";
    return (
      <Surface>
        <Card>
          <Eyebrow>Build</Eyebrow>
          <StatusRow>
            <Headline $ok={!failed} $error={failed}>
              {failed ? "Last build failed" : "Built earlier"}
            </Headline>
          </StatusRow>
          <Muted>
            This project was built before the page was reloaded, so the
            compiler's report is no longer here. Build again to see it.
          </Muted>
          <Actions>
            <Button
              kind="primary"
              disabled={building}
              onClick={() => PgCommand.build.execute()}
            >
              {building ? "Building..." : "Build"}
            </Button>
            {!failed && (
              <GradientButton onClick={() => PgFlow.setStage("deploy")}>
                Continue to Deploy
              </GradientButton>
            )}
          </Actions>
        </Card>
      </Surface>
    );
  }

  if (settled === "failed" && (!own || outIsStale)) {
    return (
      <Surface>
        <StatusRow>
          <StatusGlyph viewBox="0 0 14 14" width="18" height="18" aria-hidden>
            <circle cx="7" cy="7" r="6" className="fill" />
            <path
              d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8"
              fill="none"
              stroke="var(--on-fill)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </StatusGlyph>
          <Headline $error>
            Build failed
            <Ms>{ms}</Ms>
          </Headline>
        </StatusRow>
        <Muted>
          Build failed before the compiler ran - see the console. This usually
          means the build server could not be reached: {serverHost()}. Change it
          under Settings -&gt; Build server URL.
        </Muted>
        <Actions>
          <Button
            kind="primary"
            disabled={building}
            onClick={() => PgCommand.build.execute()}
          >
            {building ? "Building..." : "Retry build"}
          </Button>
        </Actions>
      </Surface>
    );
  }

  // Also reached while the very first build is in flight: there is no
  // previous surface to hold onto, so the empty state itself says
  // "Building..." instead of offering a live Build button mid-run.
  if (!own) {
    return (
      <Surface>
        <EmptyMark viewBox="0 0 40 40" width="40" height="40" aria-hidden>
          <rect x="6" y="20" width="6" height="14" />
          <rect x="17" y="12" width="6" height="22" />
          <rect x="28" y="6" width="6" height="28" />
        </EmptyMark>
        <Headline>{building ? "Building..." : "Nothing built yet"}</Headline>
        <Muted>
          {/* A run in flight names the server and warns about the wait. The
              Foundation's server took 381s on a cold first build and 2.9s on
              the next one (measured 2026-09-21); six unexplained minutes read
              as a hang, so say the first build is the slow one. */}
          {building ? (
            <>
              Compiling on {serverHost()}. A first build there can take several
              minutes.
            </>
          ) : (
            <>
              Build compiles your program on the server. Nothing leaves your
              browser except the source.
            </>
          )}
        </Muted>
        <Actions>
          <Button
            kind="primary"
            disabled={building}
            onClick={() => PgCommand.build.execute()}
          >
            {building ? "Building..." : "Build"}
          </Button>
        </Actions>
      </Surface>
    );
  }

  if (!own.failed) {
    return (
      <Surface>
        <Card>
          <Eyebrow>Build</Eyebrow>
          <StatusRow>
            <StatusGlyph
              $ok
              viewBox="0 0 14 14"
              width="18"
              height="18"
              aria-hidden
            >
              <circle cx="7" cy="7" r="6" className="fill" />
              <path
                d="M4.2 7.3l1.9 1.9 3.7-4"
                fill="none"
                stroke="var(--on-fill)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </StatusGlyph>
            <Headline $ok>
              Build succeeded
              <Ms>{ms}</Ms>
            </Headline>
          </StatusRow>
          <Muted>The IDL below reflects this build. Deploy when ready.</Muted>
          <Actions>
            <GradientButton onClick={() => PgFlow.setStage("deploy")}>
              Continue to Deploy
            </GradientButton>
            <IdlActions showGenerate />
            <Button onClick={() => PgFramework.exportWorkspace()}>
              Export project
            </Button>
          </Actions>
        </Card>
      </Surface>
    );
  }

  const report: BuildReport = parseBuildReport(own.stderr);
  // `countErrors` (the header badge's own count) and `parseBuildReport`
  // share one parsing convention, but rustc output that convention can't
  // split into diagnostics still leaves the badge with a count and this
  // surface with none -- fall back to the header's count rather than
  // silently showing "0 errors" next to raw compiler output that says
  // otherwise.
  const n = report.diagnostics.length || flow.buildErrorCount;
  // Top-level `warning:` blocks only -- an indented `= note:`/`= help:`
  // line under an error does not start at the beginning of the line, so
  // `^warning:` does not match it.
  const warningCount = (report.raw.match(/^warning:/gm) ?? []).length;
  const host = serverHost();
  const meta = [`${n} error${n === 1 ? "" : "s"}`, msLabel(flow.buildMs), host]
    .filter(Boolean)
    .join(" \u00b7 ");

  const compilerToggle = (
    <Toggle
      type="button"
      aria-expanded={showRaw}
      onClick={() => setShowRaw((s) => !s)}
    >
      {showRaw ? "Hide" : "Show"} compiler output
      <Chevron $open={showRaw} aria-hidden>
        <path d="M3 2l4 4-4 4" fill="none" strokeWidth="1.4" />
      </Chevron>
    </Toggle>
  );

  return (
    <Surface>
      <HeaderRow>
        <HeaderText>
          <Headline>Build failed</Headline>
          <Meta>{meta}</Meta>
        </HeaderText>
        <Button
          kind="outline"
          disabled={building}
          onClick={() => PgCommand.build.execute()}
        >
          {building ? "Building..." : "Rebuild"}
        </Button>
      </HeaderRow>

      <CardList>
        {report.diagnostics.length === 0 && (
          <Card $tone="error">
            <CardTitle>Unparsed compiler error</CardTitle>
            <Explanation>
              The compiler reported an error without a parseable diagnostic; see
              raw output.
            </Explanation>
            <CardActions>
              <CardActionsLeft>
                <GradientButton
                  onClick={() =>
                    PgAssistant.requestPrompt(
                      "Explain this build failure and propose a fix:\n" +
                        own.stderr
                    )
                  }
                >
                  Fix with assistant
                </GradientButton>
              </CardActionsLeft>
              {compilerToggle}
            </CardActions>
          </Card>
        )}
        {report.diagnostics.map((d, i) => {
          const fix = () =>
            PgAssistant.requestPrompt(
              `Explain this build error and propose a fix: ` +
                `${d.code ?? ""} ${d.title} at ${d.file}:${d.line}`
            );
          const label = extractLabel(d.excerpt);
          const humanized = humanize(d.code, d.title, label);
          const explanation = [
            humanized.explanation,
            label ? `Rustc says: ${label}.` : null,
          ]
            .filter(Boolean)
            .join(" ");
          const sourceLines = readSourceLines(d);

          return (
            <Card key={i} $tone="error">
              <CardTitle>
                {d.code && <CodeChip>{d.code}</CodeChip>}
                {humanized.title}
              </CardTitle>

              {explanation && <Explanation>{explanation}</Explanation>}

              {sourceLines ? (
                <CodeExcerpt>
                  {sourceLines.map((line) => (
                    <CodeLine key={line.num} $failing={line.failing}>
                      <LineNum>{line.num}</LineNum>
                      <LineText>{line.text}</LineText>
                      {line.failing && label && (
                        <InlineLabel>{`<- ${label}`}</InlineLabel>
                      )}
                    </CodeLine>
                  ))}
                </CodeExcerpt>
              ) : (
                d.excerpt && <Excerpt>{d.excerpt}</Excerpt>
              )}

              <CardActions>
                <CardActionsLeft>
                  {/* Gradient is reserved for one CTA per screen; only the
                      first card gets it, the rest use a plain `Button`. */}
                  {i === 0 ? (
                    <GradientButton onClick={fix}>
                      Fix with assistant
                    </GradientButton>
                  ) : (
                    <Button onClick={fix}>Fix with assistant</Button>
                  )}
                  {d.file && (
                    <Button
                      onClick={() => PgExplorer.openFile(d.file as string)}
                    >
                      Open in editor
                    </Button>
                  )}
                </CardActionsLeft>
                {compilerToggle}
              </CardActions>
            </Card>
          );
        })}
      </CardList>

      {(warningCount > 0 || showRaw) && (
        <RawSection>
          {warningCount > 0 && (
            <Toggle
              type="button"
              aria-expanded={showRaw}
              onClick={() => setShowRaw((s) => !s)}
            >
              Warnings ({warningCount})
              <Chevron $open={showRaw} aria-hidden>
                <path d="M3 2l4 4-4 4" fill="none" strokeWidth="1.4" />
              </Chevron>
            </Toggle>
          )}
          {showRaw && <Raw>{report.raw}</Raw>}
        </RawSection>
      )}
    </Surface>
  );
};

export default Build;

const rise = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
`;

const Surface = styled.div`
  ${({ theme }) => css`
    height: 100%;
    overflow-y: auto;
    padding: 2rem 1.75rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    font-family: ${theme.font.other.family};
    color: ${theme.colors.default.textPrimary};
  `}
`;

const EmptyMark = styled.svg`
  ${({ theme }) => css`
    margin-bottom: 0.25rem;
    fill: ${theme.colors.default.textSecondary};
    opacity: 0.55;
  `}
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
`;

const StatusGlyph = styled.svg<{ $ok?: boolean }>`
  ${({ theme, $ok }) => css`
    flex-shrink: 0;
    --on-fill: ${theme.colors.default.bgPrimary};

    .fill {
      fill: ${$ok
        ? theme.colors.state.success.color
        : theme.colors.state.error.color};
    }
  `}
`;

const Headline = styled.h2<{ $ok?: boolean; $error?: boolean }>`
  ${({ theme, $ok, $error }) => css`
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: ${theme.font.other.size.xlarge};
    font-weight: 600;
    letter-spacing: -0.01em;
    color: ${$ok
      ? theme.colors.state.success.color
      : $error
      ? theme.colors.state.error.color
      : theme.colors.default.textPrimary};
  `}
`;

const Ms = styled.span`
  ${({ theme }) => css`
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.other.size.small};
    font-weight: 400;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Muted = styled.p`
  ${({ theme }) => css`
    margin: 0;
    max-width: 34rem;
    font-size: ${theme.font.other.size.small};
    line-height: 1.55;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  align-items: center;
  margin-top: 0.25rem;
`;

const Eyebrow = styled.div`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.xsmall};
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  max-width: 42rem;
`;

const HeaderText = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.625rem;
`;

const Meta = styled.span`
  ${({ theme }) => css`
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  width: 100%;
  max-width: 42rem;
  margin-top: 0.5rem;
`;

const Card = styled.section<{ $tone?: "error" }>`
  ${({ theme, $tone }) => css`
    width: 100%;
    max-width: 42rem;
    padding: 1.125rem 1.25rem;
    border: 1px solid
      ${$tone === "error"
        ? PgTheme.alpha(theme.colors.state.error.color, "medium")
        : theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.components.tooltip.bg};
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    animation: ${rise} 180ms ease both;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `}
`;

const CardTitle = styled.h3`
  ${({ theme }) => css`
    margin: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: ${theme.font.other.size.medium};
    font-weight: 600;
  `}
`;

const CodeChip = styled.span`
  ${({ theme }) => css`
    padding: 0.0625rem 0.375rem;
    border: 1px solid ${theme.colors.state.error.color};
    border-radius: ${theme.default.borderRadius};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.xsmall};
    color: ${theme.colors.state.error.color};
  `}
`;

const Explanation = styled.p`
  ${({ theme }) => css`
    margin: 0;
    font-size: ${theme.font.other.size.small};
    line-height: 1.55;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Excerpt = styled.pre`
  ${({ theme }) => css`
    margin: 0;
    padding: 0.75rem 0.875rem;
    overflow-x: auto;
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgPrimary};
    border: 1px solid ${theme.colors.default.border};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    line-height: 1.5;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const CodeExcerpt = styled.div`
  ${({ theme }) => css`
    margin: 0;
    overflow-x: auto;
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgPrimary};
    border: 1px solid ${theme.colors.default.border};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    line-height: 1.7;
  `}
`;

const CodeLine = styled.div<{ $failing?: boolean }>`
  ${({ theme, $failing }) => css`
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.0625rem 0.875rem;
    white-space: pre;
    border-left: 2px solid
      ${$failing ? theme.colors.state.error.color : "transparent"};
    background: ${$failing ? theme.components.tooltip.bg : "transparent"};
  `}
`;

const LineNum = styled.span`
  ${({ theme }) => css`
    flex-shrink: 0;
    width: 1.375rem;
    text-align: right;
    color: ${theme.colors.default.textSecondary};
    opacity: 0.6;
    user-select: none;
  `}
`;

const LineText = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textPrimary};
    white-space: pre;
  `}
`;

const InlineLabel = styled.span`
  ${({ theme }) => css`
    margin-left: 0.5rem;
    color: ${theme.colors.state.error.color};
    white-space: pre;
  `}
`;

const CardActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
`;

const CardActionsLeft = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
`;

const RawSection = styled.div`
  width: 100%;
  max-width: 42rem;
  margin-top: 0.25rem;
`;

const Toggle = styled.button`
  ${({ theme }) => css`
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    border: none;
    background: none;
    padding: 0;
    color: ${theme.colors.default.textSecondary};
    cursor: pointer;
    font: inherit;
    font-size: ${theme.font.other.size.small};

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }
  `}
`;

const Chevron = styled.svg.attrs({ viewBox: "0 0 8 8", width: 8, height: 8 })<{
  $open: boolean;
}>`
  ${({ theme, $open }) => css`
    flex-shrink: 0;
    stroke: currentColor;
    transition: transform ${theme.default.transition.duration.medium}
      ${theme.default.transition.type};
    transform: rotate(${$open ? "90deg" : "0deg"});

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const Raw = styled.pre`
  ${({ theme }) => css`
    margin: 0.5rem 0 0;
    padding: 0.75rem 0.875rem;
    overflow-x: auto;
    white-space: pre-wrap;
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgPrimary};
    border: 1px solid ${theme.colors.default.border};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    line-height: 1.5;
    color: ${theme.colors.default.textSecondary};
  `}
`;
