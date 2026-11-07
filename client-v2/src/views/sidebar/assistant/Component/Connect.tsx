import { ChevronDownIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useRef, useState } from "react";

import type { ModelProvider } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";
import { cn } from "@/shared/lib/utils";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
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
import { Spinner } from "@/shared/ui/spinner";
import { Tag } from "@/shared/ui/tag";

import Link from "../../../../components/Link";
import {
  isSignInFailure,
  PgSession,
  SIGN_IN_FAILED_UNKNOWN,
} from "../../../../features/auth";
import { useRenderOnChange } from "../../../../hooks/useRenderOnChange";
import type { BackendParams } from "../model/backend-params";
import { displayModelName, EFFORT_LABELS } from "../model/labels";
import {
  type Effort,
  isDefaultBackend,
  type ProviderInfo,
  PROVIDERS,
} from "../model/types";
import { PgAssistant } from "../store";

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
    text: "proposes patches as a diff, applied only when you click Apply",
  },
  { tag: "RUNS", text: "build and deploy, each behind an explicit approval" },
  {
    tag: "KNOWS",
    text: "this project's roadmap, decisions and current status",
  },
];

const log = createLogger("assistant:connect");

const DEFAULT_PROVIDER = PROVIDERS.find((p) => p.id === "default")!;
/** Everything behind the accordion: each of these needs a key of your own */
const ALTERNATIVES = PROVIDERS.filter((p) => p.id !== "default");

/** A field's label: the theme's caption, in sentence case, untracked */
const FIELD_LABEL = "text-caption font-medium text-foreground";

/** Grey print on the theme's caption size: hints, helpers, the toggle */
const CAPTION = "text-caption text-muted-foreground";

/** A text toggle that brightens on hover; a phone's touch target is 44 */
const TEXT_TOGGLE = cn(
  CAPTION,
  "flex min-h-8 w-fit cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-normal hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-11"
);

/**
 * The backend, and maybe its model, base URL and effort, Connect a model opens
 * on: a key-based backend, or the default only for a signed-out user, for
 * whom the form is where they sign in for it. A backend's parameters as a
 * thread records them, so a field added there reaches the form too.
 */
export type ConnectPreset = BackendParams;

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

/** The endpoint fields a backend starts with, the preset's in place of its own */
const startEndpoint = (provider: ProviderInfo, preset?: ConnectPreset) =>
  provider.endpoint
    ? {
        baseUrl: preset?.baseUrl ?? provider.endpoint.baseUrl,
        model: preset?.model ?? provider.endpoint.model,
      }
    : null;

/**
 * The settings a backend starts with, the preset's model and effort in place
 * of its defaults where the backend offers them
 */
const startSettings = (provider: ProviderInfo, preset?: ConnectPreset) => {
  const settings = defaultSettings(provider);
  if (!settings || !provider.modelSettings) return settings;
  const { models, efforts } = provider.modelSettings;
  if (preset?.model && models.includes(preset.model)) {
    settings.model = preset.model;
  }
  if (preset?.effort && efforts.includes(preset.effort)) {
    settings.effort = preset.effort;
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
  /**
   * Opened on the backend already connected: its own key and choices. Not for
   * a preset, which says what to start from; one naming the connected backend
   * comes from Change key, after the provider refused that very key.
   */
  const onCurrent = !preset && current?.id === startId ? current : null;

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
      : startEndpoint(initial, preset)
  );
  const [settings, setSettings] = useState(() =>
    onCurrent?.settings
      ? { ...onCurrent.settings }
      : startSettings(initial, preset)
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

  const connect = () => PgAssistant.connect(next);

  const signIn = () => {
    setSignInError(null);
    PgSession.signInFor("assistant")([]).catch((error: unknown) => {
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
      setSignInError(SIGN_IN_FAILED_UNKNOWN);
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

  // The default is not drawn once the deployment has ruled it out, so the
  // alternatives stay open and the toggle that could hide them goes away
  const forcedOpen = defaultBackend === "absent";
  const showAlternatives = expanded || forcedOpen;
  /** Kept visible while collapsed, so the picked backend is never hidden */
  const selectedAlternative = ALTERNATIVES.find((p) => p.id === provider.id);
  /** Nothing reads as chosen while the default is still unconfirmed */
  const selectedBar = pending && provider.id === "default" ? null : provider.id;

  /** The default's one line: its own, or what it takes to use it */
  const defaultDescription = (p: ProviderInfo) =>
    signedIn || pending
      ? p.description
      : "Sign in with GitHub to use it, or bring your own key below.";

  /** The tag beside a backend's name: what using it takes */
  const providerTag = (p: ProviderInfo) => {
    if (p.id === "default" && pending) {
      return (
        <Tag variant="neutral">
          <Spinner />
          Checking…
        </Tag>
      );
    }
    if (needsSignInFor(p)) return <Tag variant="warning">sign-in needed</Tag>;
    if (!p.needsKey && !isUnavailable(p)) {
      return <Tag variant="success">no key needed</Tag>;
    }
    return undefined;
  };

  /** One backend: a row of one height, whichever is picked */
  const providerBar = (p: ProviderInfo) => (
    <label
      key={p.id}
      onPointerDown={() => (pointerPick.current = true)}
      className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:bg-surface-hover has-focus-visible:ring-2 has-focus-visible:ring-ring has-data-checked:border-primary has-data-checked:bg-primary/6 has-data-disabled:cursor-default has-data-disabled:hover:bg-transparent"
    >
      <RadioGroupItem value={p.id} disabled={isUnavailable(p)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-control text-foreground">
          {p.name}
          {providerTag(p)}
        </span>
        <span className={CAPTION}>
          {p.id === "default" ? defaultDescription(p) : p.description}
        </span>
      </span>
    </label>
  );

  const keyHelpId = "assistant-api-key-help";

  const form = (
    <div className="flex flex-col gap-5">
      {!current && (
        <p className={CAPTION}>
          The assistant reads your project and proposes fixes you apply. Pick
          what it runs on.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className={FIELD_LABEL}>Backend</div>
        {defaultBackend === "absent" && (
          <p className={CAPTION}>
            No built-in model on this deployment. Use your own key.
          </p>
        )}
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
            // bars. An arrow is still browsing, so the list stays open.
            setExpanded(!pointerPick.current);
            pointerPick.current = false;
          }}
          // A press on the checked bar changes nothing, so no pick clears the
          // flag; the next key must not fold on its behalf. An arrow opens a
          // folded list: folded, the default is the only bar and the arrow
          // has nowhere to go.
          onKeyDown={(e) => {
            pointerPick.current = false;
            if (e.key.startsWith("Arrow")) setExpanded(true);
          }}
          className="gap-2"
        >
          {/* One list in one order, folded or not, so a bar that stays keeps
              its node and its focus across a fold */}
          {[DEFAULT_PROVIDER, ...ALTERNATIVES]
            .filter((p) =>
              p.id === DEFAULT_PROVIDER.id
                ? defaultBackend !== "absent"
                : showAlternatives || p.id === selectedAlternative?.id
            )
            .map(providerBar)}
        </RadioGroup>
        {!forcedOpen && (
          <button
            type="button"
            className={TEXT_TOGGLE}
            aria-expanded={showAlternatives}
            onClick={() => setExpanded(!showAlternatives)}
          >
            {showAlternatives ? "Hide other backends" : "Bring your own key"}
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                showAlternatives && "rotate-180"
              )}
            />
          </button>
        )}
      </div>

      {provider.endpoint && endpoint && (
        <div className="flex flex-col gap-4">
          <Field>
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
              autoCapitalize="off"
              spellCheck={false}
            />
          </Field>
          <Field>
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
              autoCapitalize="off"
              spellCheck={false}
            />
          </Field>
        </div>
      )}

      {provider.modelSettings && activeSettings && (
        // Side by side on a desk, where both fit; stacked on a phone
        <div className="grid gap-4 md:grid-cols-2 md:gap-3">
          <Field>
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

          <Field>
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
        </div>
      )}

      {provider.needsKey && (
        <Field>
          <div className="flex items-baseline justify-between gap-3">
            <FieldLabel htmlFor="assistant-api-key" className={FIELD_LABEL}>
              API key{provider.keyOptional ? " (optional)" : ""}
            </FieldLabel>
            {provider.keyUrl && (
              <Link href={provider.keyUrl} className="text-caption">
                Get a key
              </Link>
            )}
          </div>
          <Input
            id="assistant-api-key"
            value={key}
            onChange={(ev) => setKey(ev.target.value)}
            placeholder={provider.keyPlaceholder}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={keyHelpId}
          />
          <p id={keyHelpId} className={CAPTION}>
            Stays in this tab&apos;s memory until you reload or delete it. Sent
            only to {provider.endpoint ? "the endpoint above" : provider.name},
            never to our server.
          </p>
        </Field>
      )}

      {/* Gone once the sign-in is no longer what the action does */}
      {needsSignIn && signInError && (
        <p role="alert" className="text-caption text-error">
          {signInError}
        </p>
      )}

      {!current && (
        // Trust detail for whoever wants it, closed so it does not compete
        // with the form
        <Collapsible>
          <CollapsibleHeading
            className={cn(TEXT_TOGGLE, "data-[state=open]:text-foreground")}
          >
            What the assistant can access
            <CollapsibleChevron className="size-3.5" />
          </CollapsibleHeading>
          <CollapsibleContent>
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 pt-2 text-caption">
              {CAPABILITIES.map(({ tag, text }) => (
                <div key={tag} className="contents">
                  <dt className="font-mono text-subtle">{tag}</dt>
                  <dd className="m-0 text-muted-foreground">{text}</dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
  return frame({ action, form });
};

export default Connect;
