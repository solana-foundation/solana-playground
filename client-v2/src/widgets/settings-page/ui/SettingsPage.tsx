import { useState, useSyncExternalStore } from "react";
import { cn } from "@/shared/lib/utils";

import Link from "@/components/Link";
import { ExportFile, Github, ImportFile } from "@/components/Icons";
import {
  useBlockExplorer,
  useProgramInfo,
  useRenderOnChange,
  useWallet,
} from "@/hooks";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import type {
  SettingsExit,
  SettingsFocus,
} from "@/shared/lib/settings-request";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { AsyncButton } from "@/shared/ui/async-button";
import { PgFramework, PgProgramInfo, PgSettings, PgView } from "@/utils";
import {
  ImportFs,
  ImportGithub,
} from "@/views/sidebar/explorer/Component/Modals";
import { groupSettings, sectionTitle } from "../model/sections";
import type { SectionId } from "../model/sections";
import { settingsTelemetry } from "../model/telemetry";
import BaseNetworkChoice from "./BaseNetworkChoice";
import BaseSettingRow from "./BaseSettingRow";
import BaseSettingsPage from "./BaseSettingsPage";
import SettingsBoundary from "./SettingsBoundary";
import type { SettingsSection } from "./BaseSettingsPage";
import { SettingControl } from "./SettingControl";

// The sections the page draws itself, typed so a rename in `SECTION_ORDER`
// fails to compile here
const NETWORK: SectionId = "network";
const PROJECT: SectionId = "project";
const BLOCK_EXPLORER: SectionId = "blockExplorer";

interface SettingsPageProps {
  focus: SettingsFocus;
  /** ⌘, is the key's own, handled where it is bound */
  onClose: (via: Exclude<SettingsExit, "key">) => void;
  /** Any network pick, the current one included (the Get set up checklist) */
  onChooseNetwork?: () => void;
}

const subscribeToModals = (onChange: () => void) =>
  PgView.onDidChangeModals(onChange).dispose;

/**
 * `BaseSettingsPage` on the live settings: the network chips, the project's
 * export and imports, then every group of `PgSettings.all`. Mounted only
 * while the settings are open.
 */
const LiveSettingsPage = ({
  focus,
  onClose,
  onChooseNetwork,
}: SettingsPageProps) => {
  const phone = useViewport() === "phone";
  const [current, setCurrent] = useState<string>(NETWORK);

  // A modal opened from the page (Import from GitHub or files, a setting's
  // Custom value) owns Escape while any is up
  const modalOpen = useSyncExternalStore(
    subscribeToModals,
    () => PgView.getOpenModals().length > 0
  );

  // The chips follow an endpoint picked elsewhere too, such as the
  // Connection section's Endpoint select
  useRenderOnChange(PgSettings.onDidChangeConnectionEndpoint);

  const own: SettingsSection[] = [
    {
      id: NETWORK,
      title: "Network",
      content: (
        <BaseNetworkChoice
          endpoint={PgSettings.connection.endpoint}
          onPick={(endpoint) => (PgSettings.connection.endpoint = endpoint)}
          onChoose={onChooseNetwork}
        />
      ),
    },
    { id: PROJECT, title: "Project", content: <Project phone={phone} /> },
  ];
  const groups = groupSettings(PgSettings.all).map(({ id, settings }) => ({
    id,
    title: sectionTitle(id),
    content: (
      <div className="flex flex-col">
        {settings.map((setting) => (
          <BaseSettingRow
            key={setting.id}
            name={setting.name}
            description={setting.description}
            control={<SettingControl {...setting} />}
            // A setting without values is a checkbox
            small={!setting.values}
            phone={phone}
          />
        ))}
        {id === BLOCK_EXPLORER && <ExplorerLinks phone={phone} />}
      </div>
    ),
  }));

  return (
    <BaseSettingsPage
      sections={[...own, ...groups]}
      current={current}
      onPick={(id) => {
        setCurrent(id);
        settingsTelemetry.track("settings_section_picked", { section: id });
      }}
      onCurrentChange={setCurrent}
      onBack={() => onClose("back")}
      phone={phone}
      focus={focus}
      onEscape={modalOpen ? null : () => onClose("escape")}
    />
  );
};

/** The live page, behind a boundary that keeps a throwing setting from taking the app down */
const SettingsPage = (props: SettingsPageProps) => (
  <SettingsBoundary onClose={props.onClose}>
    <LiveSettingsPage {...props} />
  </SettingsBoundary>
);

export default SettingsPage;

/** On a phone the prototype's buttons: a fingertip tall in the control type */
const PHONE_BUTTON = "h-12 rounded-xl text-control font-act";

const Project = ({ phone }: { phone: boolean }) => (
  <div className={cn("flex gap-2", phone ? "flex-col" : "flex-wrap")}>
    <AsyncButton
      variant="outline"
      className={phone ? PHONE_BUTTON : undefined}
      onClick={() => PgFramework.exportWorkspace()}
      onError={reportButtonFailure("export the project")}
    >
      <ExportFile data-icon="inline-start" />
      Export project (zip)
    </AsyncButton>
    <AsyncButton
      variant="outline"
      className={phone ? PHONE_BUTTON : undefined}
      onClick={() => PgView.setModal(ImportGithub)}
      onError={reportButtonFailure("open the GitHub import")}
    >
      <Github data-icon="inline-start" />
      From GitHub
    </AsyncButton>
    <AsyncButton
      variant="outline"
      className={phone ? PHONE_BUTTON : undefined}
      onClick={() => PgView.setModal(ImportFs)}
      onError={reportButtonFailure("open the file import")}
    >
      <ImportFile data-icon="inline-start" />
      From files
    </AsyncButton>
  </div>
);

/** The wallet's and the program's pages in the chosen explorer, when there are any */
const ExplorerLinks = ({ phone }: { phone: boolean }) => {
  const explorer = useBlockExplorer();
  const wallet = useWallet();
  useProgramInfo();
  const pk = PgProgramInfo.getPkStr();
  if (!wallet && !pk) return null;
  return (
    <BaseSettingRow
      name="Open in explorer"
      phone={phone}
      control={
        <div className="flex flex-wrap gap-3 text-sm">
          {wallet && (
            <Link href={explorer.getAddressUrl(wallet.publicKey.toBase58())}>
              Wallet
            </Link>
          )}
          {pk && <Link href={explorer.getAddressUrl(pk)}>Program</Link>}
          {pk && (
            <Link href={`${explorer.getAddressUrl(pk)}/idl`}>Program IDL</Link>
          )}
        </div>
      }
    />
  );
};
