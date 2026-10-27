import { FC, useCallback, useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { Rnd } from "react-rnd";

import Balance from "./Balance";
import Send from "./Send";
import Settings from "./Settings";
import Transactions from "./Transactions";
import { Button } from "@/shared/ui/button";
import FadeIn from "../FadeIn";
import ErrorBoundary from "../ErrorBoundary";
import Img from "../Img";
import Input from "../Input";
import { Close, ShortArrow } from "../Icons";
import {
  Wallet as WalletType,
  Fn,
  PgCommon,
  PgTheme,
  PgView,
  PgWallet,
} from "../../utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { MenuItemText } from "@/shared/ui/menu-extras";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useDarken } from "./hooks";
import {
  useKeybind,
  useOnClickOutside,
  useRenderOnChange,
  useWallet,
} from "../../hooks";

const Wallet = () => {
  const show = useRenderOnChange(PgWallet.onDidChangeShow);

  const wallet = useWallet();

  if (!show || !wallet) return null;

  const tabHeight = document
    .getElementById(PgView.ids.TABS)
    ?.getBoundingClientRect().height;

  return (
    <>
      <WalletBound id={WALLET_BOUND_ID} />
      <Rnd
        default={{
          x: window.innerWidth - (WALLET_WIDTH + 12),
          y: tabHeight ?? 32,
          width: "fit-content",
          height: "fit-content",
        }}
        minWidth={WALLET_WIDTH}
        maxWidth={WALLET_WIDTH}
        enableResizing={false}
        bounds={"#" + WALLET_BOUND_ID}
        enableUserSelectHack={false}
        style={{ zIndex: 1 }}
      >
        <WalletWrapper>
          <ErrorBoundary>
            <WalletTop />
            <WalletMain />
          </ErrorBoundary>
        </WalletWrapper>
      </Rnd>
    </>
  );
};

const WALLET_WIDTH = 320;

const WALLET_BOUND_ID = "wallet-bound";

const WalletBound = styled.div`
  ${({ theme }) => css`
    position: absolute;
    margin: ${theme.views.sidebar.right.title.height} 0.75rem
      ${theme.views.bottom.height} ${theme.views.sidebar.left.default.width};
    width: calc(100% - (0.75rem + ${theme.views.sidebar.left.default.width}));
    height: calc(
      100% -
        (
          ${theme.views.sidebar.right.title.height} +
            ${theme.views.bottom.height}
        )
    );
    z-index: -1;
  `}
`;

const WalletWrapper = styled(FadeIn)`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.default)};
  `}
`;

const WalletTop = () => {
  const [rename, setRename] = useState(false);

  const showRename = useCallback(() => setRename(true), []);
  const hideRename = useCallback(() => setRename(false), []);

  return (
    <WalletTopWrapper>
      <Settings showRename={showRename} />
      {rename ? <WalletRename hideRename={hideRename} /> : <WalletName />}
      <WalletClose />
    </WalletTopWrapper>
  );
};

const WalletTopWrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.top.default)};
  `}
`;

export const WalletName = () => {
  const wallet = useWallet();
  const { darken, lighten } = useDarken();

  const getAccountDisplayName = useCallback((wallet: WalletType) => {
    const name = PgCommon.withMaxLength(wallet.name, 12);

    // On standard wallet disconnect, the `publicKey` field appears `null` for a
    // brief moment until `PgWallet.getConnectedStandardWallets` runs again.
    //
    // TODO: Make sure `publicKey` can never be `null`
    if (!wallet.publicKey) return name;
    return `${name} - (${PgCommon.shorten(wallet.publicKey.toBase58())})`;
  }, []);

  if (!wallet) return null;

  return (
    <DropdownMenu onOpenChange={(open) => (open ? darken() : lighten())}>
      {/* One element carries both triggers: each `asChild` passes its props
          and ref on to `WalletTitleWrapper` */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <WalletTitleWrapper>
              {!wallet.isPg && (
                <WalletTitleIcon src={wallet.icon} alt={wallet.name} />
              )}
              <WalletTitleText>{getAccountDisplayName(wallet)}</WalletTitleText>
              <ShortArrow rotate="90deg" />
            </WalletTitleWrapper>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Accounts</TooltipContent>
      </Tooltip>
      <DropdownMenuContent>
        {/* All of the Playground Wallet accounts */}
        {PgWallet.accounts.map((acc, i) => (
          <DropdownMenuItem key={"pg-" + i} onSelect={() => PgWallet.switch(i)}>
            <MenuItemText>
              {getAccountDisplayName(PgWallet.create(acc))}
            </MenuItemText>
          </DropdownMenuItem>
        ))}
        {/* All of the connected Wallet Standard accounts */}
        {PgWallet.getConnectedStandardWallets().map((standardWallet) => (
          <DropdownMenuItem
            key={"standard-" + standardWallet.name}
            onSelect={() => {
              PgWallet.update({
                state: "sol",
                standardName: standardWallet.name,
              });
            }}
          >
            <Img src={standardWallet.icon} alt={standardWallet.name} />
            <MenuItemText>{getAccountDisplayName(standardWallet)}</MenuItemText>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const WalletTitleWrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.top.title.default)};
  `}
`;

const WalletTitleIcon = styled(Img)`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.top.title.icon)};
  `}
`;

const WalletTitleText = styled.span`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.top.title.text)};
  `}
`;

interface WalletRenameProps {
  hideRename: Fn;
}

const WalletRename: FC<React.PropsWithChildren<WalletRenameProps>> = ({
  hideRename,
}) => {
  const [name, setName] = useState(PgWallet.current!.name);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // Close on outside clicks
  useOnClickOutside(inputRef, hideRename);

  // Keybinds
  useKeybind([
    {
      keybind: "Enter",
      handle: () => {
        PgWallet.rename(name);
        hideRename();
      },
    },
    {
      keybind: "Escape",
      handle: hideRename,
    },
  ]);

  return (
    <div>
      <Input
        ref={inputRef}
        id={PgView.ids.WALLET_RENAME_INPUT}
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        validator={PgWallet.validateAccountName}
        placeholder="Rename wallet..."
      />
    </div>
  );
};

const WalletClose = () => (
  <Button
    variant="ghost"
    size="icon-sm"
    onClick={() => (PgWallet.show = false)}
    title="Close"
    className="absolute right-4"
  >
    <Close />
  </Button>
);

const WalletMain = () => (
  <MainWrapper id={PgView.ids.WALLET_MAIN}>
    <Balance />
    <Send />
    <Transactions />
  </MainWrapper>
);

const MainWrapper = styled.div`
  ${({ theme }) => css`
    &::after {
      content: "";
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
      background: transparent;
      pointer-events: none;
      transition: all ${theme.default.transition.duration.short}
        ${theme.default.transition.type};
    }

    &.${PgView.classNames.DARKEN}::after {
      ${PgTheme.convertToCSS(theme.components.wallet.main.backdrop)};
    }

    ${PgTheme.convertToCSS(theme.components.wallet.main.default)};
  `}
`;

export default Wallet;
