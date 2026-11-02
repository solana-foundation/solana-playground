import { FC, useRef } from "react";
import styled from "styled-components";

import Img from "../Img";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { MenuItemText } from "@/shared/ui/menu-extras";
import {
  Airdrop,
  Copy,
  Edit,
  ExportFile,
  ImportFile,
  Plus,
  ThreeDots,
  Trash,
} from "../Icons";
import { createLogger } from "@/shared/lib/logger";
import {
  markFailureShown,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { Fn, PgCommand, PgView, PgWallet } from "../../utils";
import { KeypairFileError } from "../../utils/wallet/keypair-file";
import { importedText } from "./imported-text";
import { useAirdrop, useDarken } from "./hooks";
import { isSignInFailure } from "../../features/auth";
import { NO_FAUCET } from "../../commands/airdrop/no-faucet";
import { useCopy } from "../../hooks";

const log = createLogger("wallet:settings");

// Radix ignores the promise an `onSelect` returns, so a rejection (a dialog
// chunk that failed to load) would be unhandled and the click would seem to do
// nothing. Log it for the team and tell the user.
const openModal = async (action: string, load: () => Promise<unknown>) => {
  try {
    await load();
  } catch (err) {
    log.error(err, { report: true, context: { action } });
    PgView.setToast(
      () => <span>Could not open that. Reload and try again.</span>,
      { options: { name: "menu-action-failed" } }
    );
  }
};

// The toast says what the import did (`importedText`). A file that is not a
// keypair is the user's to fix, so the toast says why; anything else is a
// failed click. A closed picker resolves with nothing and says nothing.
const importWallet = async () => {
  try {
    const imported = await PgWallet.import();
    if (!imported) return;

    const { name } = PgWallet.accounts[PgWallet.currentIndex];
    const text = importedText(imported, name);
    PgView.setToast(() => <span>{text}</span>, {
      options: { name: "wallet-imported" },
    });
  } catch (err) {
    if (err instanceof KeypairFileError) {
      const { message } = err;
      PgView.setToast(() => <span>{message}</span>, {
        options: { name: "wallet-import-not-keypair" },
      });
      return;
    }
    reportButtonFailure("import the wallet")(err);
  }
};

interface SettingsProps {
  showRename: Fn;
}

const Settings: FC<React.PropsWithChildren<SettingsProps>> = ({
  showRename,
}) => {
  const { airdrop, faucet } = useAirdrop();
  const { darken, lighten } = useDarken();

  const wallet = PgWallet.current!;
  const isPg = wallet.isPg;
  const [, copyAddress] = useCopy(wallet.publicKey.toBase58());

  // Choosing Rename mounts the rename input. Radix would return focus to the
  // trigger on close, so typing would go nowhere, and the input is focused
  // here once the menu has let go. Every other item keeps Radix's return.
  const choseRename = useRef(false);
  const rename = () => {
    choseRename.current = true;
    showRename();
  };

  return (
    <Wrapper>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            choseRename.current = false;
            darken();
          } else {
            lighten();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" title="More">
            <ThreeDots />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          // Wide enough for "Disconnect from <wallet>" on one line
          className="min-w-56"
          onCloseAutoFocus={(ev) => {
            if (!choseRename.current) return;
            const input = document.getElementById(
              PgView.ids.WALLET_RENAME_INPUT
            );
            if (!input) return;
            ev.preventDefault();
            input.focus();
          }}
        >
          <DropdownMenuItem onSelect={copyAddress}>
            <Copy />
            <MenuItemText>Copy address</MenuItemText>
          </DropdownMenuItem>
          {faucet === "available" && (
            <DropdownMenuItem
              onSelect={() => {
                airdrop().catch((error: unknown) => {
                  // A cancelled, blocked or refused sign-in is held in
                  // `PgSession.signInState`, and the account row shows it
                  if (isSignInFailure(error)) markFailureShown(error);
                  reportButtonFailure("airdrop")(error);
                });
              }}
            >
              <Airdrop />
              <MenuItemText>Airdrop</MenuItemText>
            </DropdownMenuItem>
          )}
          {faucet === "none" && (
            <DropdownMenuItem disabled>
              <Airdrop />
              <MenuItemText>{NO_FAUCET}</MenuItemText>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() =>
              openModal("add", async () => {
                const { Add } = await import("./Modals/Add");
                await PgView.setModal(Add);
              })
            }
          >
            <Plus />
            <MenuItemText>Add</MenuItemText>
          </DropdownMenuItem>
          {isPg && (
            <DropdownMenuItem onSelect={rename}>
              <Edit />
              <MenuItemText>Rename</MenuItemText>
            </DropdownMenuItem>
          )}
          {isPg && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                openModal("remove", async () => {
                  const { Remove } = await import("./Modals/Remove");
                  await PgView.setModal(Remove);
                })
              }
            >
              <Trash />
              <MenuItemText>Remove</MenuItemText>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={importWallet}>
            <ImportFile />
            <MenuItemText>Import</MenuItemText>
          </DropdownMenuItem>
          {isPg && (
            <DropdownMenuItem onSelect={() => PgWallet.export()}>
              <ExportFile />
              <MenuItemText>Export</MenuItemText>
            </DropdownMenuItem>
          )}
          {PgWallet.standardWallets.map((standardWallet) => (
            <DropdownMenuItem
              key={standardWallet.name}
              variant={standardWallet.connected ? "destructive" : "default"}
              onSelect={() => {
                PgCommand.connect
                  .execute(standardWallet.name.toLowerCase())
                  .catch(
                    reportButtonFailure(
                      standardWallet.connected
                        ? `disconnect from ${standardWallet.name}`
                        : `connect ${standardWallet.name}`
                    )
                  );
              }}
            >
              <Img src={standardWallet.icon} alt={standardWallet.name} />
              <MenuItemText>
                {standardWallet.connected
                  ? `Disconnect from ${standardWallet.name}`
                  : `Connect to ${standardWallet.name}`}
              </MenuItemText>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  position: absolute;
  left: 1rem;
`;

export default Settings;
