import { Pencil, Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useState } from "react";

import type { CustomRpc } from "@/entities/custom-rpc";
import { hostOf, RPC_NAME_MAX } from "@/entities/custom-rpc";
import { Button } from "@/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/ui/input-group";

/** What saving answers: done, or the line to show under the URL */
export type CustomRpcSaveAnswer = { ok: true } | { ok: false; error: string };

interface BaseCustomRpcsProps {
  rpcs: ReadonlyArray<CustomRpc>;
  /** Save a new RPC */
  onAdd: (input: CustomRpc) => CustomRpcSaveAnswer;
  /** Save over the saved `rpc` */
  onEdit: (rpc: CustomRpc, input: CustomRpc) => CustomRpcSaveAnswer;
  onRemove: (rpc: CustomRpc) => void;
}

/** Spec 07's help line for a custom RPC */
const HELP = "Any Solana RPC URL. It stays in this browser.";

/** Which form is open: none, a new RPC's, or the edit of the one at this URL */
type Editing = undefined | "new" | { url: string };

/**
 * The saved custom RPCs under the network chips, each with Edit and Remove,
 * and the inline form that adds or edits one. A row shows the URL's host
 * only: the path and query often carry a provider's key.
 */
const BaseCustomRpcs = ({
  rpcs,
  onAdd,
  onEdit,
  onRemove,
}: BaseCustomRpcsProps) => {
  const [editing, setEditing] = useState<Editing>();
  const handleClose = () => setEditing(undefined);

  return (
    <div className="flex flex-col gap-2">
      {rpcs.length > 0 && (
        <ul aria-label="Custom RPCs" className="flex flex-col">
          {rpcs.map((rpc) =>
            typeof editing === "object" && editing.url === rpc.url ? (
              <li key={rpc.url}>
                <RpcForm
                  initial={rpc}
                  onSave={(input) => onEdit(rpc, input)}
                  onClose={handleClose}
                />
              </li>
            ) : (
              <li
                key={rpc.url}
                className="flex items-center gap-2 border-b border-border py-1.5"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-caption text-foreground">
                    {rpc.name}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {hostOf(rpc.url)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${rpc.name}`}
                  className="max-md:size-12"
                  onClick={() => setEditing({ url: rpc.url })}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${rpc.name}`}
                  className="max-md:size-12"
                  onClick={() => onRemove(rpc)}
                >
                  <Trash2 />
                </Button>
              </li>
            )
          )}
        </ul>
      )}
      {editing === "new" ? (
        <RpcForm onSave={onAdd} onClose={handleClose} />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          // Pulled out by its own left padding, so the plus lines up with
          // the saved RPCs' names and the hover box keeps its size
          className="-ml-1.5 self-start max-md:h-12"
          onClick={() => setEditing("new")}
        >
          <Plus data-icon="inline-start" />
          Add custom RPC
        </Button>
      )}
    </div>
  );
};

/** Name, then URL with Save, the help line and the refusal under it */
const RpcForm = ({
  initial,
  onSave,
  onClose,
}: {
  initial?: CustomRpc;
  onSave: (input: CustomRpc) => CustomRpcSaveAnswer;
  onClose: () => void;
}) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState<string>();
  const id = useId();

  const handleSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    const answer = onSave({ name, url });
    if (answer.ok) onClose();
    else setError(answer.error);
  };

  return (
    <form
      aria-label={initial ? `Edit ${initial.name}` : "Add custom RPC"}
      className="flex flex-col gap-3 py-2"
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={RPC_NAME_MAX}
          autoFocus
          className="max-md:h-12"
          onChange={(ev) => setName(ev.target.value)}
        />
      </Field>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={`${id}-url`}>RPC URL</FieldLabel>
        <InputGroup className="max-md:h-12">
          <InputGroupInput
            id={`${id}-url`}
            value={url}
            placeholder="https://"
            // The field's invalid state reddens its text; the value stays the
            // user's own, as the DS validator input draws it
            className="text-foreground"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-help ${id}-error` : `${id}-help`}
            onChange={(ev) => {
              setUrl(ev.target.value);
              setError(undefined);
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit">Save</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription id={`${id}-help`}>{HELP}</FieldDescription>
        <FieldError id={`${id}-error`}>{error}</FieldError>
      </Field>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start max-md:h-12"
        onClick={onClose}
      >
        Cancel
      </Button>
    </form>
  );
};

export default BaseCustomRpcs;
