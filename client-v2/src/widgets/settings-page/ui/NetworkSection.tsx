import { useEffect, useState } from "react";

import { DEFAULT_ENDPOINT } from "@/constants";
import type { CustomRpc } from "@/entities/custom-rpc";
import { fetchRpcHealth, PgCustomRpcs } from "@/entities/custom-rpc";
import { useRenderOnChange } from "@/hooks";
import { Button } from "@/shared/ui/button";
import { PgGlobal, PgSettings, PgView } from "@/utils";
import type { ToastChildProps } from "@/utils/view";

import { canSwitchNetwork } from "../model/network-hold";
import { answerFor, saveCheckedWith } from "../model/save-custom-rpc";
import { settingsTelemetry } from "../model/telemetry";
import BaseCustomRpcs from "./BaseCustomRpcs";
import BaseNetworkChoice from "./BaseNetworkChoice";

/**
 * Whether a running deploy holds the network on the RPC saved under `url`:
 * it is the one in use, and a deploy is running or paused
 */
const isHeld = (url: string) =>
  PgSettings.connection.endpoint === url &&
  !canSwitchNetwork(PgGlobal.deployState);

/** Save a custom RPC once its URL answers one health request (Spec 07) */
const saveChecked = saveCheckedWith(fetchRpcHealth)(isHeld);

/** Say that a running deploy holds the network where it is */
const toastNetworkHeld = () =>
  PgView.setToast(
    () => <span>A deploy is running. Change the network when it ends.</span>,
    { options: { name: "network-held-by-deploy" } }
  );

const pick = (url: string) => {
  if (!canSwitchNetwork(PgGlobal.deployState)) {
    toastNetworkHeld();
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
  // The chips follow an endpoint picked elsewhere too, such as the terminal
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

  // A new RPC is picked at once, whether checked or saved through "Use anyway"
  const handleAdd = async (input: CustomRpc) =>
    answerFor((saved) => pick(saved.url))("add")(
      await saveChecked(input, undefined)
    );

  // An edited RPC keeps the connection on it when it is the one in use at
  // the moment it saves. A new URL for that RPC would move the network, so
  // `saveChecked` refuses it while a deploy runs, before the health request
  // and again at the write; a rename still saves
  const handleEdit = async (rpc: CustomRpc, input: CustomRpc) =>
    answerFor((saved) => {
      if (PgSettings.connection.endpoint === rpc.url) pick(saved.url);
    })("edit")(await saveChecked(input, rpc.url));

  const handleRemove = (rpc: CustomRpc) => {
    const wasPicked = PgSettings.connection.endpoint === rpc.url;
    // Removing the RPC in use moves the network to Devnet, so a running
    // deploy keeps it listed rather than leaving the connection on an RPC
    // the list no longer has
    if (isHeld(rpc.url)) {
      toastNetworkHeld();
      return;
    }
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
