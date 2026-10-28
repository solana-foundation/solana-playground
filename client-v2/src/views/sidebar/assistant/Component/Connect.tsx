import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { createLogger } from "@/shared/lib/logger";
import { cn } from "@/shared/lib/utils";
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
import { isSignInFailure, PgSession } from "../../../../features/auth";
import { useRenderOnChange } from "../../../../hooks/useRenderOnChange";
import { PgAssistant } from "../store";
import type { ModelProvider } from "@/shared/lib/ai";
import {
  isDefaultBackend,
  PROVIDERS,
  type Effort,
  type ProviderInfo,
} from "../model/types";
import { displayModelName, EFFORT_LABELS } from "../model/labels";

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

const log = createLogger("assistant:connect");

const DEFAULT_PROVIDER = PROVIDERS.find((p) => p.id === "default")!;
/** Everything behind the accordion: each of these needs a key of your own */
const ALTERNATIVES = PROVIDERS.filter((p) => p.id !== "default");

/** The prototype's field label: small, grey, in sentence case, untracked */
const FIELD_LABEL = "text-[0.7rem] font-normal text-muted-foreground";

const MUTED = "text-[0.7rem] text-[var(--text-secondary)]";
const NOTE = cn(MUTED, "pt-[0.875rem] leading-[1.6]");

/** The backend, and maybe the model, Connect a model opens on */
export interface ConnectPreset {
  /**
   * A key-based backend, or the default only for a signed-out user: the
   * form is where they sign in for it
   */
  provider: ModelProvider;
  /** A model of the backend's own list, or its endpoint's model id */
  model?: string;
}

/**
 * The form's one action. Its host draws it (`ConnectProps.frame`): Connect a
 * model puts it in the dialog's footer, which a phone pins to the bottom of
 * the screen.
 */
export interface ConnectAction {
  /**
   * "Switch" over a connection, "Connect" for a key, "Start" without one, and
   * "Sign in with GitHub" for the default backend while nobody is signed in
   */
  text: "Start" | "Switch" | "Connect" | "Sign in with GitHub";
  /** Every field the backend needs is filled in */
  ready: boolean;
  /** Connects, or for "Sign in with GitHub" starts the sign-in */
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
 * The form of Connect a model. It lives in `ConnectDialog`, which gives the
 * dialog its title and closes it once a backend is connected; the form heads
 * only its own lead. Reconnecting on load is `useTurn`'s.
 */
const Connect = ({ defaultBackend, preset, frame }: ConnectProps) => {
  // Reopened over a live connection: seed the fields with it so changing just
  // the model id does not mean retyping the key
  const current = PgAssistant.connection;
  // `/api/agent` spends the deployment's key only for a signed-in caller
  useRenderOnChange(PgSession.onDidChange);
  const signedIn = !!PgSession.get();
  const startId = preset?.provider ?? current?.id ?? "default";
  const initial = PROVIDERS.find((p) => p.id === startId)!;
  /** Opened on the backend already connected: its own key and choices */
  const onCurrent = current?.id === startId ? current : null;

  const [providerId, setProviderId] = useState<ModelProvider>(startId);
  const [expanded, setExpanded] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
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
  /** Served here, but `/api/agent` refuses this user's turns until they sign in */
  const needsSignInFor = (p: ProviderInfo) =>
    isDefaultBackend(p.id) && defaultBackend === "present" && !signedIn;
  /** The action signs in instead of connecting */
  const needsSignIn = needsSignInFor(provider);
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

  const signIn = () => {
    setSignInError(null);
    PgSession.signIn({ from: "assistant" }).catch((error: unknown) => {
      if (isSignInFailure(error)) {
        // Not reported: a blocked popup or a cancelled sign-in is expected,
        // and its message says what to do
        log.info("sign-in from Connect a model failed", {
          context: { error: String(error) },
        });
        setSignInError((error as Error).message);
        return;
      }
      log.error(error, { report: true, context: { from: "assistant" } });
      setSignInError("Sign-in failed. Try again.");
    });
  };

  let actionText: ConnectAction["text"] = "Start";
  if (current) actionText = "Switch";
  else if (provider.needsKey) actionText = "Connect";
  const action: ConnectAction = needsSignIn
    ? {
        text: "Sign in with GitHub",
        // A second press while the popup is open would only join it
        ready: PgSession.signInState().status !== "pending",
        connect: signIn,
      }
    : { text: actionText, ready, connect };

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
    if (defaultBackend !== "present") {
      return (
        "Not configured on this deployment — pick a backend below and supply " +
        "your own key."
      );
    }
    return signedIn
      ? p.description
      : "Sign in with GitHub to use it, or bring your own key below.";
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
        "relative flex cursor-pointer items-start gap-2 rounded-xl border border-border has-focus-visible:ring-2 has-focus-visible:ring-ring px-2.5 py-2 transition-colors hover:bg-accent has-data-checked:border-primary has-data-disabled:cursor-not-allowed has-data-disabled:opacity-45 has-data-disabled:hover:bg-transparent"
      )}
    >
      {/* The card is the choice, as the prototype draws it; the circle
          stays for the keyboard and the screen reader */}
      <RadioGroupItem
        value={p.id}
        disabled={isUnavailable(p)}
        // Unseen, over the whole card: a press anywhere on it is a press on
        // the radio itself (`sr-only` would lose to the item's own `relative`
        // and `size-4`)
        className="absolute inset-0 size-full rounded-xl border-0 opacity-0"
      />
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "flex items-center gap-2 text-sm",
            selectedBar === p.id ? "text-primary" : "text-foreground"
          )}
        >
          {p.name}
          {needsSignInFor(p) && (
            <span className="text-[0.7rem] text-warning">sign-in needed</span>
          )}
          {!p.needsKey && !isUnavailable(p) && !needsSignInFor(p) && (
            <span className="text-[0.7rem] text-success">no key needed</span>
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

  const form = (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 pb-5">
        <h3 className="text-[0.8125rem] leading-normal font-medium text-[var(--text-primary)]">
          {current
            ? "Switch backend"
            : "An assistant that can see your project"}
        </h3>
        {!current && (
          <div className="text-[0.75rem] leading-[1.65] text-[var(--text-secondary)]">
            It reads the tab you are looking at and the last build error,
            explains what went wrong against your actual code, and proposes
            patches you apply yourself.
          </div>
        )}
        {!current && defaultBackend === "present" && (
          <div className="text-[0.75rem] leading-[1.65] text-[var(--text-secondary)]">
            Out of the box it runs on this deployment's own backend, with the
            capabilities listed below. Bring your own key to run it on something
            else.
          </div>
        )}
      </div>

      <div className={cn(MUTED, "block pb-[0.4375rem]")}>Backend</div>
      <div className="flex flex-col gap-1.5 pb-4">
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
          <button
            type="button"
            className={cn(
              MUTED,
              "flex cursor-pointer items-center gap-1.5 self-start border-none bg-transparent py-0.5 hover:text-[var(--text-primary)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary"
            )}
            aria-expanded={showAlternatives}
            onClick={() => setExpanded(!showAlternatives)}
          >
            {showAlternatives ? "Hide other backends" : "Bring your own key"}
            <span
              className={cn(
                "inline-block leading-none transition-transform duration-150 ease-linear",
                showAlternatives && "rotate-180"
              )}
            >
              ▾
            </span>
          </button>
        )}
      </div>

      {provider.endpoint && endpoint && (
        <>
          <Field className="mb-3">
            <FieldLabel htmlFor="assistant-base-url" className={FIELD_LABEL}>
              Base URL
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
              Model
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
              Model
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
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {provider.modelSettings.models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {displayModelName(m)}
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
              Effort
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
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {provider.modelSettings.efforts.map((e) => (
                  <SelectItem key={e} value={e}>
                    {EFFORT_LABELS[e]}
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
              API key{provider.keyOptional ? " (optional)" : ""}
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

      {/* Gone once the sign-in is no longer what the action does */}
      {needsSignIn && signInError && (
        <div
          role="alert"
          className="pt-2 text-[0.7rem] leading-[1.6] text-error"
        >
          {signInError}
        </div>
      )}

      {switching && (
        <div className={NOTE}>
          Switching starts a new conversation. The current one cannot be
          replayed to another backend.
        </div>
      )}

      {provider.needsKey && (
        <div className={NOTE}>
          Kept in this tab until you press Forget key or close it; a copy of
          this tab keeps it too. Sent only to{" "}
          {provider.endpoint ? "the endpoint above" : provider.name}, never to
          our server.
        </div>
      )}

      {!current && (
        <div className="flex flex-col gap-2 pt-5">
          {CAPABILITIES.map(({ tag, text }, i) => (
            <div
              key={text}
              className={cn(MUTED, "flex gap-[0.5625rem] leading-[1.55]")}
            >
              {/* One tag per run of rows sharing it, so it reads as a group */}
              <span className="w-[3.25rem] shrink-0 tracking-[0.06em] text-primary">
                {tag === CAPABILITIES[i - 1]?.tag ? "" : tag}
              </span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}

      {provider.keyUrl && (
        <div className={cn(MUTED, "mt-auto pt-5 text-center")}>
          No key? <Link href={provider.keyUrl}>Create one</Link>
        </div>
      )}
    </div>
  );
  return frame({ action, form });
};

export default Connect;
