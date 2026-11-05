import { useEffect, useState } from "react";

import { DEFAULT_ENDPOINT } from "@/constants";
import type { CustomRpc, SaveResult } from "@/entities/custom-rpc";
import { PgCustomRpcs } from "@/entities/custom-rpc";
import { useRenderOnChange } from "@/hooks";
import { Button } from "@/shared/ui/button";
import { PgGlobal, PgSettings, PgView } from "@/utils";
import type { ToastChildProps } from "@/utils/view";

import { canSwitchNetwork } from "../model/network-hold";
import { settingsTelemetry } from "../model/telemetry";
import type { CustomRpcSaveAnswer } from "./BaseCustomRpcs";
import BaseCustomRpcs from "./BaseCustomRpcs";
import BaseNetworkChoice from "./BaseNetworkChoice";

/** The line under the URL field for a refused save (Spec 07's copy) */
const refusal = (result: Exclude<SaveResult, { ok: true }>): string => {
  switch (result.reason) {
    case "format":
      return "Enter a URL that starts with https://, or http:// for a local validator.";
    case "duplicate":
      return `Already saved as ${result.name}.`;
    case "storage":
      return "Could not save in this browser.";
  }
};

const pick = (url: string) => {
  if (!canSwitchNetwork(PgGlobal.deployState)) {
    PgView.setToast(
      () => <span>A deploy is running. Change the network when it ends.</span>,
      { options: { name: "network-held-by-deploy" } }
    );
    return;
  }
  PgSettings.connection.endpoint = url;
};

/**
 * List the connection's endpoint when it is a custom one, and move the
 * connection onto the spelling it is listed under, so its chip is checked
 */
const adoptEndpoint = (endpoint: string) => {
  const listed = PgCustomRpcs.adopt(endpoint);
  // A re-spelling of the same RPC waits for a running deploy silently: the
  // user asked for nothing, so no toast
  if (!listed || listed === endpoint) return;
  if (!canSwitchNetwork(PgGlobal.deployState)) return;
  PgSettings.connection.endpoint = listed;
};

/** The toast after a remove, with the Undo that puts the RPC back */
const Removed = ({
  id,
  name,
  wasPicked,
  onUndo,
}: ToastChildProps & {
  name: string;
  wasPicked: boolean;
  onUndo: () => void;
}) => (
  <span className="flex items-center gap-3">
    <span>
      {wasPicked
        ? `Removed ${name}. Network is Devnet now.`
        : `Removed ${name}.`}
    </span>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        onUndo();
        PgView.closeToast(id);
      }}
    >
      Undo
    </Button>
  </span>
);

/**
 * The Network section on the live settings: the chips, Devnet, Mainnet and
 * each saved custom RPC, and the list that adds, edits and removes them.
 */
const NetworkSection = () => {
  // The chips follow an endpoint picked elsewhere too, such as the
  // Connection section's Endpoint select
  useRenderOnChange(PgSettings.onDidChangeConnectionEndpoint);
  const endpoint = PgSettings.connection.endpoint;

  const [rpcs, setRpcs] = useState<CustomRpc[]>(PgCustomRpcs.list);
  useEffect(() => {
    const changes = PgCustomRpcs.onDidChange(() =>
      setRpcs(PgCustomRpcs.list())
    );
    // A custom endpoint set before the list existed, or elsewhere, is listed
    const endpoints = PgSettings.onDidChangeConnectionEndpoint((url) => {
      if (typeof url === "string") adoptEndpoint(url);
    });
    adoptEndpoint(PgSettings.connection.endpoint);
    return () => {
      changes.dispose();
      endpoints.dispose();
    };
  }, []);

  /** Report a save's result; a refusal becomes the line under the field */
  const answerFor =
    (mode: "add" | "edit") =>
    (result: SaveResult): CustomRpcSaveAnswer => {
      if (!result.ok) {
        settingsTelemetry.track("settings_custom_rpc_refused", {
          reason: result.reason,
        });
        return { ok: false, error: refusal(result) };
      }
      settingsTelemetry.track("settings_custom_rpc_saved", { mode });
      return { ok: true };
    };

  // A new RPC is picked at once
  const handleAdd = (input: CustomRpc) => {
    const result = PgCustomRpcs.save(input);
    if (result.ok) pick(result.rpc.url);
    return answerFor("add")(result);
  };

  // An edited RPC keeps the connection on it when it was the one in use
  const handleEdit = (rpc: CustomRpc, input: CustomRpc) => {
    const wasPicked = PgSettings.connection.endpoint === rpc.url;
    const result = PgCustomRpcs.replace(rpc.url, input);
    if (result.ok && wasPicked) pick(result.rpc.url);
    return answerFor("edit")(result);
  };

  const handleRemove = (rpc: CustomRpc) => {
    const wasPicked = PgSettings.connection.endpoint === rpc.url;
    const removed = PgCustomRpcs.remove(rpc.url);
    if (!removed) {
      // Gone already (another tab), or the browser refused; the store
      // reported which
      PgView.setToast(() => <span>Could not remove {rpc.name}.</span>, {
        options: { name: "custom-rpc-remove-failed" },
      });
      return;
    }
    if (wasPicked) pick(DEFAULT_ENDPOINT);
    settingsTelemetry.track("settings_custom_rpc_removed", {
      picked: wasPicked,
    });
    PgView.setToast(Removed, {
      componentProps: {
        name: rpc.name,
        wasPicked,
        onUndo: () => {
          if (!PgCustomRpcs.restore(removed.rpc, removed.index)) {
            PgView.setToast(() => <span>Could not put {rpc.name} back.</span>, {
              options: { name: "custom-rpc-restore-failed" },
            });
            return;
          }
          // Only while the network is still the Devnet the remove moved it
          // to: a network picked since then stays
          if (
            wasPicked &&
            PgSettings.connection.endpoint === DEFAULT_ENDPOINT
          ) {
            pick(removed.rpc.url);
          }
        },
      },
      options: { name: "custom-rpc-removed" },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <BaseNetworkChoice endpoint={endpoint} custom={rpcs} onPick={pick} />
      <BaseCustomRpcs
        rpcs={rpcs}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onRemove={handleRemove}
      />
    </div>
  );
};

export default NetworkSection;
