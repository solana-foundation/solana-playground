import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import styled, { css } from "styled-components";

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
import Link from "../../../../components/Link";
import { PgAssistant } from "../store";
import {
  PROVIDERS,
  type Effort,
  type ProviderId,
  type ProviderInfo,
} from "../model/types";

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

const DEFAULT_PROVIDER = PROVIDERS.find((p) => p.id === "default")!;
/** Everything behind the accordion: each of these needs a key of your own */
const ALTERNATIVES = PROVIDERS.filter((p) => p.id !== "default");

const FIELD_LABEL = "text-xs tracking-[0.1em] text-muted-foreground";

/** The backend, and maybe the model, Connect a model opens on */
export interface ConnectPreset {
  /** A key-based backend: the default needs no form opened on it */
  provider: Exclude<ProviderId, "default">;
  /** A model of the backend's own list, or its endpoint's model id */
  model?: string;
}

/**
 * The form's one action. Its host draws it (`ConnectProps.frame`): Connect a
 * model puts it in the dialog's footer, which a phone pins to the bottom of
 * the screen.
 */
export interface ConnectAction {
  /** "Switch" over a connection, "Connect" for a key, "Start" without one */
  text: "Start" | "Switch" | "Connect";
  /** Every field the backend needs is filled in */
  ready: boolean;
  connect(): void;
}

/**
 * Whether this deployment serves a keyless default backend. `checking` while
 * the answer is outstanding: the option is neither offered nor ruled out
 * until the server has said, so a fork with no key of its own never
 * preselects a backend that cannot answer. Declared here, not taken from the
 * assistant widget, so this view imports nothing from the layers.
 */
export type ConnectDefault = "checking" | "present" | "absent";

export interface ConnectProps {
  defaultBackend: ConnectDefault;
  preset?: ConnectPreset;
  /**
   * Draws the form and its action. Handed both on every render, the first
   * included, so a host can place the action outside the form (a dialog's
   * footer) and have it there when the dialog opens and gives out focus.
   */
  frame(parts: { action: ConnectAction; form: ReactNode }): ReactElement;
}

/** The endpoint fields a backend starts with, `model` in place of its own */
const startEndpoint = (provider: ProviderInfo, model?: string) =>
  provider.endpoint
    ? {
        baseUrl: provider.endpoint.baseUrl,
        model: model ?? provider.endpoint.model,
      }
    : null;

/** The settings a backend starts with, `model` in place of its default */
const startSettings = (provider: ProviderInfo, model?: string) => {
  const settings = defaultSettings(provider);
  if (settings && model && provider.modelSettings?.models.includes(model)) {
    settings.model = model;
  }
  return settings;
};

/**
 * The form of Connect a model. It lives in `ConnectDialog`, which gives it its
 * title and closes it once a backend is connected; reconnecting on load is
 * `useTurn`'s.
 */
const Connect = ({ defaultBackend, preset, frame }: ConnectProps) => {
  // Reopened over a live connection: seed the fields with it so changing just
  // the model id does not mean retyping the key
  const current = PgAssistant.connection;
  const startId = preset?.provider ?? current?.id ?? "default";
  const initial = PROVIDERS.find((p) => p.id === startId)!;
  /** Opened on the backend already connected: its own key and choices */
  const onCurrent = current?.id === startId ? current : null;

  const [providerId, setProviderId] = useState<ProviderId>(startId);
  const [expanded, setExpanded] = useState(false);
  /**
   * The pick in flight came from a pointer. Radix checks a radio as the arrow
   * keys reach it, so a pick is also every step of a keyboard walk -- and
   * folding on those took the rest of the list away after one step.
   */
  const pointerPick = useRef(false);
  const [key, setKey] = useState(onCurrent?.apiKey ?? "");
  const [endpoint, setEndpoint] = useState<{
    baseUrl: string;
    model: string;
  } | null>(() =>
    onCurrent?.endpoint
      ? { ...onCurrent.endpoint }
      : startEndpoint(initial, preset?.model)
  );
  const [settings, setSettings] = useState(() =>
    onCurrent?.settings
      ? { ...onCurrent.settings }
      : startSettings(initial, preset?.model)
  );

  /** The probe is still out: the default is neither offered nor ruled out yet */
  const pending = defaultBackend === "checking";

  /**
   * Declared unavailable, or a default backend this deployment has not
   * confirmed. Pending counts as unavailable, so the option is never shown
   * ready and then withdrawn a moment later.
   */
  const isUnavailable = (p: ProviderInfo) =>
    !!p.unavailable || (p.id === "default" && defaultBackend !== "present");

  // The probe can rule out the preselected default after the fact; fall back
  // rather than leaving a dead option selected
  const fallenBack =
    providerId === "default" && defaultBackend === "absent"
      ? "anthropic"
      : null;
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
  const ready = keyReady && endpointReady && !isUnavailable(provider);

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

  const connect = () => PgAssistant.connect(next);

  let actionText: ConnectAction["text"] = "Start";
  if (current) actionText = "Switch";
  else if (provider.needsKey) actionText = "Connect";
  const action: ConnectAction = { text: actionText, ready, connect };

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
    return defaultBackend === "present"
      ? p.description
      : "Not configured on this deployment — pick a backend below and supply " +
          "your own key.";
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
          {!p.needsKey && !isUnavailable(p) && <NoKey>no key needed</NoKey>}
        </span>
        {!compact && (
          <span className="pt-[0.1875rem] text-xs leading-normal text-muted-foreground">
            {p.id === "default" ? defaultDescription(p) : p.description}
          </span>
        )}
      </span>
    </label>
  );

  const form = (
    <Wrapper>
      {!current && (
        <Intro>
          <Lead>
            It reads the tab you are looking at and the last build error,
            explains what went wrong against your actual code, and proposes
            patches you apply yourself.
          </Lead>
          {defaultBackend === "present" && (
            <Lead>
              Out of the box it runs on this deployment's own backend, with the
              capabilities listed below. Bring your own key to run it on
              something else.
            </Lead>
          )}
        </Intro>
      )}

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
              placeholder={provider.keyPlaceholder}
              type="password"
              autoComplete="off"
            />
          </Field>
        </>
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
  return frame({ action, form });
};

/** The dialog's body scrolls and pads; the form only stacks */
const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
`;

const Intro = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding-bottom: 1.25rem;
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
