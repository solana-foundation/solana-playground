import { useEffect, useState } from "react";

import { DEFAULT_ENDPOINT, NETWORKS } from "@/constants";
import type { CustomRpc } from "@/entities/cluster";
import { fetchRpcHealth, isSameRpc, PgCustomRpcs } from "@/entities/cluster";
import { useRenderOnChange } from "@/hooks";
import { Button } from "@/shared/ui/button";
import { PgGlobal, PgSettings, PgView } from "@/utils";
import type { ToastChildProps } from "@/utils/view";

import { canSwitchNetwork, networkHeldBy } from "../model/network-hold";
import { answerFor, saveCheckedWith } from "../model/save-custom-rpc";
import { settingsTelemetry } from "../model/telemetry";
import BaseCustomRpcs from "./BaseCustomRpcs";
import BaseNetworkChoice, {
  checkedChipKey,
  chipKey,
} from "./BaseNetworkChoice";

/**
 * Whether the network is held on the RPC saved under `url`: it is the one in
 * use, and a deploy runs or waits paused, or an `anchor idl` write runs
 */
const isHeld = (url: string) =>
  PgSettings.connection.endpoint === url && !canSwitchNetwork(PgGlobal);

/** Save a custom RPC once its URL answers one health request (spec `client-v2-custom-rpcs`) */
const saveChecked = saveCheckedWith(fetchRpcHealth)(isHeld);

/** Say what holds the network where it is: a deploy or an IDL write */
const toastNetworkHeld = () => {
  if (networkHeldBy(PgGlobal) === "idl") {
    PgView.setToast(
      () => (
        <span>
          An anchor idl command is running. Change the network when it ends.
        </span>
      ),
      { options: { name: "network-held-by-idl" } }
    );
    return;
  }
  PgView.setToast(
    () => <span>A deploy is running. Change the network when it ends.</span>,
    { options: { name: "network-held-by-deploy" } }
  );
};

/** Move the network to `url`; false, with a toast, while a deploy or an IDL write holds it */
const pick = (url: string): boolean => {
  if (!canSwitchNetwork(PgGlobal)) {
    toastNetworkHeld();
    return false;
  }
  PgSettings.connection.endpoint = url;
  return true;
};

/**
 * List the connection's endpoint when it is a custom one, and move the
 * connection onto the spelling it is listed under, so its chip is checked
 */
const adoptEndpoint = (endpoint: string) => {
  const listed = PgCustomRpcs.adopt(endpoint);
  // A re-spelling of the same RPC waits for a held network silently: the
  // user asked for nothing, so no toast
  if (!listed || listed === endpoint) return;
  if (!canSwitchNetwork(PgGlobal)) return;
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
 * The Network section on the live settings: the chips, the offered networks
 * and each saved custom RPC, and the list that adds, edits and removes them.
 */
const NetworkSection = () => {
  // The chips follow an endpoint picked elsewhere too, such as the terminal
  useRenderOnChange(PgSettings.onDidChangeConnectionEndpoint);
  const endpoint = PgSettings.connection.endpoint;

  const [rpcs, setRpcs] = useState<CustomRpc[]>(PgCustomRpcs.list);
  // Which chip is checked when several share the endpoint's URL, kept
  // across a reload: the checked one must not jump to another on load
  const [chosen, setChosenState] = useState(PgCustomRpcs.chosen);
  const setChosen = (key: string) => {
    setChosenState(key);
    PgCustomRpcs.choose(key);
  };
  // The check moves only with the network: a held pick keeps both
  const choose = (rpc: CustomRpc) => {
    if (pick(rpc.url)) setChosen(chipKey(rpc.name, rpc.url));
  };
  /** Whether `rpc` is the checked chip, not only one on the URL in use */
  const isChecked = (rpc: CustomRpc) =>
    checkedChipKey(rpcs, {
      endpoint: PgSettings.connection.endpoint,
      chosen,
    }) === chipKey(rpc.name, rpc.url);
  // A chip on the URL in use already moves the check, not the network
  const handlePick = (url: string, key: string) => {
    if (url === PgSettings.connection.endpoint || pick(url)) setChosen(key);
  };
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
    answerFor(choose)("add")(await saveChecked(input, undefined));

  // An edited RPC keeps the connection on it when its chip is the checked
  // one as the edit starts; another chip on the same URL leaves the network
  // alone. A new URL for the RPC in use would move the network, so
  // `saveChecked` refuses it while a deploy runs, before the health request
  // and again at the write; a rename still saves
  const handleEdit = async (rpc: CustomRpc, input: CustomRpc) => {
    const wasChecked = isChecked(rpc);
    return answerFor((saved) => {
      // Still on its URL: another chip picked during the check keeps the network
      if (wasChecked && PgSettings.connection.endpoint === rpc.url) {
        choose(saved);
      }
    })("edit")(await saveChecked(input, rpc));
  };

  const handleRemove = (rpc: CustomRpc) => {
    // Another chip on the same URL keeps the network where it is
    const wasPicked =
      PgSettings.connection.endpoint === rpc.url &&
      // Spelt as the chips compare it, the endpoint against the raw value
      !NETWORKS.some((n) => n.value === rpc.url) &&
      !rpcs.some((r) => r.url === rpc.url && !isSameRpc(r, rpc));
    // Removing the RPC in use moves the network to Devnet, so a running
    // deploy keeps it listed rather than leaving the connection on an RPC
    // the list no longer has
    if (isHeld(rpc.url)) {
      toastNetworkHeld();
      return;
    }
    const removed = PgCustomRpcs.remove(rpc);
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
      <BaseNetworkChoice
        endpoint={endpoint}
        custom={rpcs}
        chosen={chosen}
        onPick={handlePick}
      />
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
