import { useState, useSyncExternalStore } from "react";

import { Github, ImportFile } from "@/components/Icons";
import Link from "@/components/Link";
import { useBlockExplorer, useProgramInfo, useWallet } from "@/hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import type {
  SettingsExit,
  SettingsFocus,
} from "@/shared/lib/settings-request";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { PgProgramInfo, PgSettings, PgView } from "@/utils";
import {
  ImportFs,
  ImportGithub,
  isImported,
} from "@/views/sidebar/explorer/Component/Modals";

import type { SectionId } from "../model/sections";
import { groupSettings, sectionTitle } from "../model/sections";
import { settingsTelemetry } from "../model/telemetry";
import AssistantKey from "./AssistantKey";
import BaseSettingRow from "./BaseSettingRow";
import type { SettingsSection } from "./BaseSettingsPage";
import BaseSettingsPage from "./BaseSettingsPage";
import ExportProject, { OpenProjectLine } from "./ExportProject";
import NetworkSection from "./NetworkSection";
import { SettingControl } from "./SettingControl";
import SettingsBoundary from "./SettingsBoundary";

// The sections the page draws itself, typed so a rename in `SECTION_ORDER`
// fails to compile here
const NETWORK: SectionId = "network";
const ASSISTANT: SectionId = "assistant";
const PROJECT: SectionId = "project";
const BLOCK_EXPLORER: SectionId = "blockExplorer";

interface SettingsPageProps {
  focus: SettingsFocus;
  /** ⌘, is the key's own, handled where it is bound */
  onClose: (via: Exclude<SettingsExit, "key">) => void;
}

const subscribeToModals = (onChange: () => void) =>
  PgView.onDidChangeModals(onChange).dispose;

/**
 * `BaseSettingsPage` on the live settings: the network chips, Delete my key,
 * the project's export and imports, then every group of `PgSettings.all`.
 * Mounted only while the settings are open.
 */
const LiveSettingsPage = ({ focus, onClose }: SettingsPageProps) => {
  const phone = useViewport() === "phone";
  const [current, setCurrent] = useState<string>(NETWORK);

  // A modal opened from the page (Import from GitHub or files, a setting's
  // Custom value) owns Escape while any is up
  const modalOpen = useSyncExternalStore(
    subscribeToModals,
    () => PgView.getOpenModals().length > 0
  );

  const own: SettingsSection[] = [
    {
      id: NETWORK,
      title: "Network",
      content: <NetworkSection />,
    },
    {
      id: ASSISTANT,
      title: "Assistant",
      content: <AssistantKey phone={phone} />,
    },
    {
      id: PROJECT,
      title: "Project",
      content: <Project phone={phone} onImported={() => onClose("import")} />,
    },
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

interface ProjectProps {
  phone: boolean;
  /** A project was imported and opened: the page gets out of its way */
  onImported: () => void;
}

const Project = ({ phone, onImported }: ProjectProps) => {
  const open = (dialog: typeof ImportGithub | typeof ImportFs) => async () => {
    if (isImported(await PgView.setModal(dialog))) onImported();
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <OpenProjectLine phone={phone} />
      <div className={cn("flex gap-2", phone ? "flex-col" : "flex-wrap")}>
        <ExportProject className={phone ? PHONE_BUTTON : undefined} />
        <AsyncButton
          variant="outline"
          className={phone ? PHONE_BUTTON : undefined}
          onClick={open(ImportGithub)}
          onError={reportButtonFailure("open the GitHub import")}
        >
          <Github data-icon="inline-start" />
          From GitHub
        </AsyncButton>
        <AsyncButton
          variant="outline"
          className={phone ? PHONE_BUTTON : undefined}
          onClick={open(ImportFs)}
          onError={reportButtonFailure("open the file import")}
        >
          <ImportFile data-icon="inline-start" />
          From files
        </AsyncButton>
      </div>
    </div>
  );
};

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
