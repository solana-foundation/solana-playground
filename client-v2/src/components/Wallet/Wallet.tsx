import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Rnd } from "react-rnd";
import styled, { css } from "styled-components";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { HelpTip } from "@/shared/ui/help-tip";
import { Icon } from "@/shared/ui/icon";
import { MenuItemText } from "@/shared/ui/menu-extras";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import {
  useKeybind,
  useOnClickOutside,
  useRenderOnChange,
  useWallet,
} from "../../hooks";
import {
  Fn,
  PgCommon,
  PgTheme,
  PgView,
  PgWallet,
  Wallet as WalletType,
} from "../../utils";
import ErrorBoundary from "../ErrorBoundary";
import FadeIn from "../FadeIn";
import Img from "../Img";
import Input from "../Input";
import { forgetWalletAnchor, walletAnchor } from "./anchor";
import Balance from "./Balance";
import { useDarken } from "./hooks";
import Send from "./Send";
import Settings from "./Settings";
import Transactions from "./Transactions";

const Wallet = () => {
  const show = useRenderOnChange(PgWallet.onDidChangeShow);

  const wallet = useWallet();

  if (!show || !wallet) return null;

  return <FloatingWallet />;
};

/** Space between the wallet chip and the window opened above it */
const ANCHOR_GAP = 8;

const FloatingWallet = () => {
  const rnd = useRef<Rnd>(null);
  // Read once: the window stays where it opened until the user drags it
  const [anchor] = useState(walletAnchor);
  const isDragged = useRef(false);
  useEffect(() => forgetWalletAnchor, []);

  const tabHeight = document
    .getElementById(PgView.ids.TABS)
    ?.getBoundingClientRect().height;
  const top = tabHeight ?? 32;

  // Opened from the chip, the window sits right above it, right edges
  // aligned like the chip's popover (Almaz, 25 Nov). Its height is known only
  // once it renders and grows as the balance and transactions load, so its
  // bottom stays pinned above the chip until the user drags it.
  useLayoutEffect(() => {
    const el = rnd.current?.getSelfElement();
    if (!anchor || !el) return;
    const place = () => {
      if (isDragged.current) return;
      rnd.current?.updatePosition({
        x: Math.max(12, anchor.right - WALLET_WIDTH),
        y: Math.max(top, anchor.top - el.offsetHeight - ANCHOR_GAP),
      });
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor, top]);

  return (
    <>
      <WalletBound id={WALLET_BOUND_ID} />
      <Rnd
        ref={rnd}
        onDragStart={() => {
          isDragged.current = true;
        }}
        default={{
          x: window.innerWidth - (WALLET_WIDTH + 12),
          y: top,
          width: "fit-content",
          height: "fit-content",
        }}
        minWidth={WALLET_WIDTH}
        maxWidth={WALLET_WIDTH}
        enableResizing={false}
        bounds={"#" + WALLET_BOUND_ID}
        enableUserSelectHack={false}
        // Above the page (the program cards' buttons are `z-10`), under the
        // full pages (`z-40`) and the dialogs and menus (`z-50`)
        style={{ zIndex: 30 }}
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
  // The account items are disabled while a deploy holds the accounts
  useRenderOnChange(PgWallet.onDidChangeSwitchHeld);
  const { darken, lighten } = useDarken();

  const getAccountDisplayName = useCallback((account: WalletType) => {
    const name = PgCommon.withMaxLength(account.name, 12);

    // On standard wallet disconnect, the `publicKey` field appears `null` for a
    // brief moment until `PgWallet.getConnectedStandardWallets` runs again.
    //
    // TODO: Make sure `publicKey` can never be `null`
    if (!account.publicKey) return name;
    return `${name} - (${PgCommon.shorten(account.publicKey.toBase58())})`;
  }, []);

  if (!wallet) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
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
                <WalletTitleText>
                  {getAccountDisplayName(wallet)}
                </WalletTitleText>
                <Icon name="chevron-down" size={16} />
              </WalletTitleWrapper>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Accounts</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          {/* All of the Playground Wallet accounts */}
          {PgWallet.accounts.map((acc, i) => (
            <DropdownMenuItem
              key={"pg-" + i}
              // A running deploy holds the accounts (`PgWallet.holdSwitch`)
              disabled={PgWallet.isSwitchHeld}
              onSelect={() => PgWallet.switch(i)}
            >
              <MenuItemText>
                {getAccountDisplayName(PgWallet.create(acc))}
              </MenuItemText>
            </DropdownMenuItem>
          ))}
          {/* All of the connected Wallet Standard accounts */}
          {PgWallet.getConnectedStandardWallets().map((standardWallet) => (
            <DropdownMenuItem
              key={"standard-" + standardWallet.name}
              disabled={PgWallet.isSwitchHeld}
              onSelect={() => PgWallet.selectStandard(standardWallet.name)}
            >
              {/* An image, which the item does not size as it does its icons */}
              <Img
                src={standardWallet.icon}
                alt={standardWallet.name}
                className="size-4 shrink-0 rounded-sm"
              />
              <MenuItemText>
                {getAccountDisplayName(standardWallet)}
              </MenuItemText>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Beside the trigger, not in it: a button inside a button. Only a
          Playground wallet is kept here and signs without asking */}
      {wallet.isPg && (
        <HelpTip label="About the Playground wallet">{PG_WALLET_HELP}</HelpTip>
      )}
    </span>
  );
};

/** Spec 12's "Wallet panel help" */
const PG_WALLET_HELP =
  "A wallet kept in this browser. Playground uses it to deploy and to sign your calls without asking. Use it for devnet, testnet and local clusters only.";

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
    <Icon name="close" />
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
