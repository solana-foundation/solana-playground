import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import { createLogger } from "@/shared/lib/logger";
import { cn } from "cn";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import GradientButton from "../../../../components/GradientButton";
import Link from "../../../../components/Link";
import { PgSession } from "../../../../features/auth";
import { useRenderOnChange } from "../../../../hooks/useRenderOnChange";
import { PgAssistant } from "../store";
import {
  isDefaultBackendRemembered,
  rememberedConnection,
} from "../model/remembered-backend";
import {
  DEFAULT_BACKEND_URL,
  isDefaultBackend,
  PROVIDERS,
  type Effort,
  type ProviderId,
  type ProviderInfo,
} from "../model/types";

const log = createLogger("assistant:connect");

/** Model and effort a backend starts on, when it offers the choice */
const defaultSettings = (provider: ProviderInfo) =>
  provider.modelSettings ? { ...provider.modelSettings.defaults } : undefined;

const CAPABILITIES = [
  {
    tag: "READS",
    text:
      "the tab you are looking at, every file in the project, your cluster, " +
      "wallet status and program id, the last failed build's compiler output",
  },
  {
    tag: "WRITES",
    text: "proposes patches as a diff — applied only when you click Apply",
  },
  { tag: "RUNS", text: "build and deploy, each behind an explicit approval" },
  {
    tag: "KNOWS",
    text: "this project's roadmap, decisions and current status",
  },
  {
    tag: "KNOWS",
    text:
      "where you are in a lesson — the step, its objective and whether it " +
      "is proven yet",
  },
];

/**
 * Whether this deployment configured a default backend.
 *
 * `undefined` while the answer is outstanding: the option is neither offered
 * nor ruled out until the server has said, so a fork with no key of its own
 * never preselects a backend that cannot answer.
 */
const useDefaultBackend = () => {
  const [configured, setConfigured] = useState<boolean>();

  useEffect(() => {
    let live = true;
    fetch(DEFAULT_BACKEND_URL)
      .then((r) => {
        if (r.ok) return r.json();
        // A deployment without `/api/agent` answers 404, and one whose agent
        // is down a 5xx; either way there is no default to offer. Not
        // reported: the picker still works on the user's own key.
        log.warn("the default backend probe was refused", {
          context: { status: r.status },
        });
        return { configured: false };
      })
      .catch((error) => {
        // No answer at all (a network failure) or one that is not JSON.
        // Expected off a full deployment, so not reported.
        log.warn("could not probe the default backend", {
          context: { reason: error instanceof Error ? error.name : "unknown" },
        });
        return { configured: false };
      })
      // `null` is valid JSON, so the body is not assumed to be an object
      .then((body) => live && setConfigured(!!body?.configured));
    return () => {
      live = false;
    };
  }, []);

  return configured;
};

const DEFAULT_PROVIDER = PROVIDERS.find((p) => p.id === "default")!;
/** Everything behind the accordion: each of these needs a key of your own */
const ALTERNATIVES = PROVIDERS.filter((p) => p.id !== "default");

const FIELD_LABEL = "text-xs tracking-[0.1em] text-muted-foreground";

const Connect = () => {
  // Reopened over a live connection: seed the fields with it so changing just
  // the model id does not mean retyping the key
  const current = PgAssistant.connection;
  const defaultBackend = useDefaultBackend();
  // `/api/agent` spends the deployment's key only for a signed-in caller
  useRenderOnChange(PgSession.onDidChange);
  const signedIn = !!PgSession.get();

  const initial = PROVIDERS.find((p) => p.id === (current?.id ?? "default"))!;

  const [providerId, setProviderId] = useState<ProviderId>(
    current?.id ?? "default"
  );
  const [expanded, setExpanded] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  /**
   * The pick in flight came from a pointer. Radix checks a radio as the arrow
   * keys reach it, so a pick is also every step of a keyboard walk -- and
   * folding on those took the rest of the list away after one step.
   */
  const pointerPick = useRef(false);
  const [key, setKey] = useState(current?.apiKey ?? "");
  const [endpoint, setEndpoint] = useState<{
    baseUrl: string;
    model: string;
  } | null>(() => (current?.endpoint ? { ...current.endpoint } : null));
  const [settings, setSettings] = useState(() =>
    current?.settings ? { ...current.settings } : defaultSettings(initial)
  );

  /** The probe is still out: the default is neither offered nor ruled out yet */
  const pending = defaultBackend === undefined;
  /** The probe confirmed this deployment serves a default backend */
  const isDefaultBackendConfigured = defaultBackend === true;
  /** Served here, and `/api/agent` answers this user because they are signed in */
  const canUseDefaultBackend = isDefaultBackendConfigured && signedIn;

  /**
   * Reconnect to the key-based backend this tab was using before a reload.
   *
   * Kept in `sessionStorage` by `rememberBackend`, so a freshly opened tab
   * never gets here with one; a tab the browser duplicates or restores
   * carries it, and reconnects as after a reload. Needs no probe: the probe
   * only says whether this deployment serves the default backend. Guarded
   * like the `isDefaultBackendRemembered` reconnect -- nothing connected,
   * picker not opened on purpose -- so the user's own Forget key or Change
   * backend is not undone.
   *
   * Runs on mount, before the probe can answer, which is what makes it win
   * over a remembered default: the default's reconnect then finds a
   * connection and stands down. `Connect.test.tsx` pins that order.
   */
  useEffect(() => {
    if (PgAssistant.connection || PgAssistant.isPickingBackend) return;
    const remembered = rememberedConnection();
    if (remembered) PgAssistant.connect(remembered);
  }, []);

  /**
   * Reconnect to the default backend without making the user ask twice.
   *
   * A reload lands here with nothing connected unless this tab kept a
   * key-based connection (the `rememberedConnection` reconnect) -- and for
   * the keyless default that meant clicking the same button again before the
   * panel could be used at all. Only a backend the user has already chosen is
   * reconnected, and only once the probe confirms this deployment still
   * serves it.
   *
   * Deliberately not run when `isPickingBackend`: the user opened this on
   * purpose to change something, and connecting out from under them would
   * throw the choice away mid-edit.
   */
  useEffect(() => {
    if (!canUseDefaultBackend) return;
    if (PgAssistant.connection || PgAssistant.isPickingBackend) return;
    if (!isDefaultBackendRemembered()) return;

    PgAssistant.connect({ id: "default", apiKey: "" });
  }, [canUseDefaultBackend]);

  /**
   * Declared unavailable, or a default backend this deployment has not
   * confirmed. Pending counts as unavailable, so the option is never shown
   * ready and then withdrawn a moment later.
   */
  const isUnavailable = (p: ProviderInfo) =>
    !!p.unavailable || (p.id === "default" && !isDefaultBackendConfigured);

  // The probe can rule out the preselected default after the fact; fall back
  // rather than leaving a dead option selected
  const fallenBack =
    providerId === "default" && defaultBackend === false ? "anthropic" : null;
  const provider = PROVIDERS.find((p) => p.id === (fallenBack ?? providerId))!;
  // The fallback never went through `pickProvider`, so its pickers need seeding
  const activeSettings = settings ?? defaultSettings(provider);

  const pickProvider = (p: typeof PROVIDERS[number]) => {
    setProviderId(p.id);
    // Seed the endpoint fields with the provider's defaults, editable from there
    setEndpoint(p.endpoint ? { ...p.endpoint } : null);
    setSettings(
      p.id === current?.id && current.settings
        ? { ...current.settings }
        : defaultSettings(p)
    );
    // A key belongs to the backend it was issued for: never carry it across.
    // Coming back to the connected one restores its own key. A keyboard walk
    // clears it too, step by step: a key typed for one backend is no more
    // valid for the next one the arrows pass through.
    setKey(p.id === current?.id ? current.apiKey : "");
  };

  const keyReady = !provider.needsKey || provider.keyOptional || !!key.trim();
  const endpointReady =
    !provider.endpoint ||
    (!!endpoint?.baseUrl.trim() && !!endpoint?.model.trim());
  /** Served here, but `/api/agent` refuses this user's turns until they sign in */
  const needsSignInFor = (p: ProviderInfo) =>
    isDefaultBackend(p.id) && isDefaultBackendConfigured && !signedIn;
  /** The button signs in instead of connecting */
  const needsSignIn = needsSignInFor(provider);
  const ready =
    keyReady && endpointReady && !isUnavailable(provider) && !needsSignIn;

  const trimmedEndpoint = endpoint
    ? { baseUrl: endpoint.baseUrl.trim(), model: endpoint.model.trim() }
    : undefined;
  const next = {
    id: provider.id,
    apiKey: key.trim(),
    endpoint: trimmedEndpoint,
    settings: activeSettings,
  };
  const switching = !!current && !PgAssistant.isCurrent(next);

  // `Button` restores its own state after awaiting this handler, so unmounting
  // synchronously would leave it setting state on an unmounted component.
  const connect = () => setTimeout(() => PgAssistant.connect(next), 0);

  // Nothing selectable is on screen while the default is ruled out, so the
  // alternatives stay open and the toggle that could hide them goes away
  const forcedOpen = !!fallenBack;
  const showAlternatives = expanded || forcedOpen;
  /** Kept visible while collapsed, so the picked backend is never hidden */
  const selectedAlternative = ALTERNATIVES.find((p) => p.id === provider.id);
  /** Nothing reads as chosen while the default is still unconfirmed */
  const selectedBar = pending && provider.id === "default" ? null : provider.id;

  const defaultDescription = (p: ProviderInfo) => {
    if (pending) return "Checking this deployment for a default backend…";
    if (!isDefaultBackendConfigured) {
      return (
        "Not configured on this deployment — pick a backend below and supply " +
        "your own key."
      );
    }
    return signedIn
      ? p.description
      : "Sign in with GitHub to use it, or bring your own key below.";
  };

  const connectLabel = () => {
    if (current) return "Switch";
    if (provider.needsKey) return "Connect";
    return "Start";
  };

  const signIn = () => {
    setSignInError(null);
    return PgSession.signIn({ from: "assistant" }).catch((error: unknown) => {
      // Not reported: a blocked popup or a cancelled sign-in is expected
      log.info("sign-in from the assistant panel failed", {
        context: { error: String(error) },
      });
      setSignInError(
        error instanceof Error ? error.message : "Sign-in failed. Try again."
      );
    });
  };

  /**
   * @param compact drop the description, so the open list stays short enough
   * to keep the toggle and the connect button above the fold
   */
  const providerBar = (p: ProviderInfo, compact = false) => (
    <label
      key={p.id}
      onPointerDown={() => (pointerPick.current = true)}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-2 transition-colors hover:bg-accent has-data-checked:border-primary has-data-disabled:cursor-not-allowed has-data-disabled:opacity-45 has-data-disabled:hover:bg-transparent"
      )}
    >
      <RadioGroupItem
        value={p.id}
        disabled={isUnavailable(p)}
        className="mt-0.5"
      />
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "flex items-center gap-2 text-sm",
            selectedBar === p.id ? "text-primary" : "text-foreground"
          )}
        >
          {p.name}
          {needsSignInFor(p) && <SignInNeeded>sign-in needed</SignInNeeded>}
          {!p.needsKey && !isUnavailable(p) && !needsSignInFor(p) && (
            <NoKey>no key needed</NoKey>
          )}
        </span>
        {!compact && (
          <span className="pt-[0.1875rem] text-xs leading-normal text-muted-foreground">
            {p.id === "default" ? defaultDescription(p) : p.description}
          </span>
        )}
      </span>
    </label>
  );

  return (
    <Wrapper>
      {current && !PgAssistant.needsSignIn && (
        <Back onClick={() => PgAssistant.keepBackend()}>Back to chat</Back>
      )}

      <Intro>
        <Title>
          {current
            ? "Switch backend"
            : "An assistant that can see your project"}
        </Title>
        {!current && (
          <Lead>
            It reads the tab you are looking at and the last build error,
            explains what went wrong against your actual code, and proposes
            patches you apply yourself.
          </Lead>
        )}
        {!current && isDefaultBackendConfigured && (
          <Lead>
            Out of the box it runs on this deployment's own backend, with the
            capabilities listed below. Bring your own key to run it on something
            else.
          </Lead>
        )}
      </Intro>

      <Label as="div">BACKEND</Label>
      <Providers>
        <RadioGroup
          aria-label="Backend"
          value={selectedBar ?? ""}
          onValueChange={(id) => {
            // The group can only produce an id it was given, so a miss is a bug
            const found = [DEFAULT_PROVIDER, ...ALTERNATIVES].find(
              (p) => p.id === id
            );
            if (!found) throw new Error(`Unknown provider: ${id}`);
            pickProvider(found);
            // A click is the end of browsing: fold the list back to the two
            // bars. The arrow keys are still browsing.
            if (pointerPick.current) setExpanded(false);
            pointerPick.current = false;
          }}
          // A press on the checked bar changes nothing, so no pick clears the
          // flag; the next key must not fold on its behalf
          onKeyDown={() => (pointerPick.current = false)}
          className="gap-1.5"
        >
          {providerBar(DEFAULT_PROVIDER)}
          {showAlternatives
            ? ALTERNATIVES.map((p) => providerBar(p, p.id !== provider.id))
            : selectedAlternative && providerBar(selectedAlternative)}
        </RadioGroup>
        {!forcedOpen && (
          <Toggle
            type="button"
            aria-expanded={showAlternatives}
            onClick={() => setExpanded(!showAlternatives)}
          >
            {showAlternatives ? "Hide other backends" : "Bring your own key"}
            <Chevron $open={showAlternatives}>▾</Chevron>
          </Toggle>
        )}
      </Providers>

      {provider.endpoint && endpoint && (
        <>
          <Field className="mb-3">
            <FieldLabel htmlFor="assistant-base-url" className={FIELD_LABEL}>
              BASE URL
            </FieldLabel>
            <Input
              id="assistant-base-url"
              value={endpoint.baseUrl}
              onChange={(ev) =>
                setEndpoint({ ...endpoint, baseUrl: ev.target.value })
              }
              placeholder={provider.endpoint.baseUrl}
              autoComplete="off"
            />
          </Field>
          <Field className="mb-3">
            <FieldLabel htmlFor="assistant-model" className={FIELD_LABEL}>
              MODEL
            </FieldLabel>
            {provider.endpoint.models && (
              <Segmented
                variant="chips"
                aria-label="Model presets"
                value={
                  provider.endpoint.models.includes(endpoint.model)
                    ? endpoint.model
                    : ""
                }
                onValueChange={(m) => setEndpoint({ ...endpoint, model: m })}
                className="pb-[0.4375rem]"
              >
                {provider.endpoint.models.map((m) => (
                  <SegmentedItem key={m} value={m} className="font-mono">
                    {m}
                  </SegmentedItem>
                ))}
              </Segmented>
            )}
            <Input
              id="assistant-model"
              value={endpoint.model}
              onChange={(ev) =>
                setEndpoint({ ...endpoint, model: ev.target.value })
              }
              placeholder={provider.endpoint.model}
              autoComplete="off"
            />
          </Field>
        </>
      )}

      {provider.modelSettings && activeSettings && (
        <>
          <Field className="mb-3">
            <FieldLabel
              htmlFor="assistant-model-select"
              className={FIELD_LABEL}
            >
              MODEL
            </FieldLabel>
            <Select
              value={activeSettings.model}
              onValueChange={(model) =>
                setSettings({ ...activeSettings, model })
              }
            >
              <SelectTrigger
                id="assistant-model-select"
                aria-label="Model"
                className="w-full font-mono"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {provider.modelSettings.models.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field className="mb-3">
            <FieldLabel
              htmlFor="assistant-effort-select"
              className={FIELD_LABEL}
            >
              EFFORT
            </FieldLabel>
            <Select
              value={activeSettings.effort}
              onValueChange={(effort) =>
                setSettings({ ...activeSettings, effort: effort as Effort })
              }
            >
              <SelectTrigger
                id="assistant-effort-select"
                aria-label="Effort"
                className="w-full font-mono"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {provider.modelSettings.efforts.map((e) => (
                  <SelectItem key={e} value={e} className="font-mono">
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      {provider.needsKey && (
        <>
          <Field className="mb-3">
            <FieldLabel htmlFor="assistant-api-key" className={FIELD_LABEL}>
              API KEY{provider.keyOptional ? " (OPTIONAL)" : ""}
            </FieldLabel>
            <Input
              id="assistant-api-key"
              value={key}
              onChange={(ev) => setKey(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && ready) connect();
              }}
              placeholder={provider.keyPlaceholder}
              type="password"
              autoComplete="off"
            />
          </Field>
        </>
      )}

      {needsSignIn ? (
        <>
          <ConnectButton kind="primary" fullWidth onClick={signIn}>
            Sign in with GitHub
          </ConnectButton>
          {signInError && <SignInError role="alert">{signInError}</SignInError>}
        </>
      ) : (
        <ConnectButton
          kind="primary"
          fullWidth
          disabled={!ready}
          onClick={connect}
        >
          {connectLabel()}
        </ConnectButton>
      )}

      {switching && (
        <Note>
          Switching starts a new conversation. The current one cannot be
          replayed to another backend.
        </Note>
      )}

      {provider.needsKey && (
        <Note>
          Kept in this tab until you press Forget key or close it; a copy of
          this tab keeps it too. Sent only to{" "}
          {provider.endpoint ? "the endpoint above" : provider.name}, never to
          our server.
        </Note>
      )}

      {!current && (
        <Capabilities>
          {CAPABILITIES.map(({ tag, text }, i) => (
            <Capability key={text}>
              {/* One tag per run of rows sharing it, so it reads as a group */}
              <Tag>{tag === CAPABILITIES[i - 1]?.tag ? "" : tag}</Tag>
              <span>{text}</span>
            </Capability>
          ))}
        </Capabilities>
      )}

      {provider.keyUrl && (
        <Footer>
          No key? <Link href={provider.keyUrl}>Create one</Link>
        </Footer>
      )}
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 1rem;
`;

const Back = styled.button`
  ${({ theme }) => css`
    align-self: flex-start;
    padding: 0 0 0.75rem;
    background: transparent;
    border: none;
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.small};
    cursor: pointer;

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
    }
  `}
`;

const Intro = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding-bottom: 1.25rem;
`;

const Title = styled.h2`
  ${({ theme }) => css`
    margin: 0;
    color: ${theme.colors.default.textPrimary};
    font-size: ${theme.font.code.size.medium};
    font-weight: 600;
    line-height: 1.5;
  `}
`;

const Lead = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.small};
    line-height: 1.65;
  `}
`;

const Label = styled.label`
  ${({ theme }) => css`
    display: block;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    letter-spacing: 0.1em;
    padding-bottom: 0.4375rem;
  `}
`;

const Providers = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding-bottom: 1rem;
`;

const NoKey = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.state.success.color};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const SignInNeeded = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.state.warning.color};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const Toggle = styled.button`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    align-self: flex-start;
    gap: 0.375rem;
    padding: 0.125rem 0;
    background: transparent;
    border: none;
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.xsmall};
    cursor: pointer;

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }
  `}
`;

const Chevron = styled.span<{ $open: boolean }>`
  ${({ theme, $open }) => css`
    display: inline-block;
    line-height: 1;
    transform: rotate(${$open ? "180deg" : "0deg"});
    transition: transform ${theme.default.transition.duration.medium}
      ${theme.default.transition.type};
  `}
`;

const ConnectButton = styled(GradientButton)`
  margin-top: 0.75rem;
`;

const SignInError = styled.div`
  ${({ theme }) => css`
    padding-top: 0.5rem;
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.6;
  `}
`;

const Note = styled.div`
  ${({ theme }) => css`
    padding-top: 0.875rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.6;
  `}
`;

const Capabilities = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 1.25rem;
`;

const Capability = styled.div`
  ${({ theme }) => css`
    display: flex;
    gap: 0.5625rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.55;
  `}
`;

const Tag = styled.span`
  ${({ theme }) => css`
    width: 3.25rem;
    flex-shrink: 0;
    color: ${theme.colors.default.primary};
    letter-spacing: 0.06em;
  `}
`;

const Footer = styled.div`
  ${({ theme }) => css`
    margin-top: auto;
    padding-top: 1.25rem;
    text-align: center;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

export default Connect;
