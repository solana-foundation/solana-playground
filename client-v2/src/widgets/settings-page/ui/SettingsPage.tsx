import { Globe, Keyboard, Palette } from "lucide-react";
import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";

import { Github } from "@/components/Icons";
import Link from "@/components/Link";
import { useBlockExplorer, useProgramInfo, useWallet } from "@/hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import type {
  SettingsExit,
  SettingsFocus,
} from "@/shared/lib/settings-request";
import { AsyncButton } from "@/shared/ui/async-button";
import { Icon } from "@/shared/ui/icon";
import { PgCommon, PgProgramInfo, PgSettings, PgView } from "@/utils";
import {
  ImportFs,
  ImportGithub,
  isImported,
} from "@/views/sidebar/explorer/Component/Modals";

import type { GroupId, SectionId, SettingRow } from "../model/sections";
import {
  GROUPS,
  SECTION_DESCRIPTIONS,
  SECTION_ORDER,
  sectionTitle,
  settingRows,
} from "../model/sections";
import { settingsTelemetry } from "../model/telemetry";
import AssistantKey from "./AssistantKey";
import type { HostedModel } from "./BaseAssistantStatus";
import BaseAssistantStatus from "./BaseAssistantStatus";
import BaseCodeSample from "./BaseCodeSample";
import BaseSettingRow from "./BaseSettingRow";
import BaseSettingsCard from "./BaseSettingsCard";
import type { SettingsSection } from "./BaseSettingsPage";
import BaseSettingsPage from "./BaseSettingsPage";
import BaseShortcuts from "./BaseShortcuts";
import ExportProject, { OpenProjectLine } from "./ExportProject";
import NetworkSection from "./NetworkSection";
import { SettingControl } from "./SettingControl";
import SettingsBoundary from "./SettingsBoundary";

const NETWORK: SectionId = "network";

type Row = SettingRow<typeof PgSettings.all[number]>;

// The line set's glyphs; it has none yet for a network, a theme or a
// keyboard, so those three are Lucide at the set's stroke
const ICONS: Record<SectionId, ReactNode> = {
  network: <Globe strokeWidth={1.5} aria-hidden />,
  assistant: <Icon name="assistant" />,
  editor: <Icon name="write" />,
  build: <Icon name="build" />,
  wallet: <Icon name="wallet" />,
  appearance: <Palette strokeWidth={1.5} aria-hidden />,
  shortcuts: <Keyboard strokeWidth={1.5} aria-hidden />,
  project: <Icon name="folder" />,
  advanced: <Icon name="settings" />,
};

/** Settings whose few values read better side by side than in a select */
const SEGMENTED = new Set(["editor.keybinding"]);

/** What the Editor section says on a phone, where Vim keys need a keyboard */
const PHONE_EDITOR_NOTE = "Vim key bindings need a hardware keyboard.";

interface SettingsPageProps {
  focus: SettingsFocus;
  /** Whether the hosted model answers, as the assistant's probe says */
  hosted: HostedModel;
  /** ⌘, is the key's own, handled where it is bound */
  onClose: (via: Exclude<SettingsExit, "key">) => void;
}

const subscribeToModals = (onChange: () => void) =>
  PgView.onDidChangeModals(onChange).dispose;

/**
 * `BaseSettingsPage` on the live settings, in the designed sections (Spec 07):
 * the network chips, the hosted model, every row of `PgSettings.all` under its
 * designed label on cards by group, the shortcuts, the project's export and
 * imports, and the user's key last, in Advanced. Mounted only while the
 * settings are open.
 */
const LiveSettingsPage = ({ focus, hosted, onClose }: SettingsPageProps) => {
  const phone = useViewport() === "phone";
  const [current, setCurrent] = useState<string>(NETWORK);

  // A modal opened from the page (Import from GitHub or files, a setting's
  // Custom value) owns Escape while any is up
  const modalOpen = useSyncExternalStore(
    subscribeToModals,
    () => PgView.getOpenModals().length > 0
  );

  const rows = settingRows(PgSettings.all);
  const rowOf = ({ setting, label, help, tag }: Row) => {
    const controlId = `setting-${setting.id}`;
    const note =
      phone && setting.id === "editor.keybinding" ? PHONE_EDITOR_NOTE : help;
    const row = (
      <BaseSettingRow
        key={setting.id}
        name={label}
        description={note}
        tag={tag}
        controlId={controlId}
        control={
          <SettingControl
            {...setting}
            name={label}
            controlId={controlId}
            segmented={SEGMENTED.has(setting.id)}
          />
        }
        // A switch or a few side by side fit beside the text
        small={!setting.values || SEGMENTED.has(setting.id)}
        phone={phone}
      />
    );
    if (setting.id !== "ui.font") return row;
    // A font is easier to pick when it shows; one cell, so no hairline
    // between the row and its sample
    return (
      <div key={setting.id}>
        {row}
        <BaseCodeSample font={setting.getValue()} />
      </div>
    );
  };

  /** A section's rows, one card per run of rows in the same group */
  const cardsOf = (id: SectionId, links?: ReactNode) => {
    const runs: { group?: GroupId; rows: Row[] }[] = [];
    for (const row of rows.get(id) ?? []) {
      const last = runs.at(-1);
      if (last && last.group === row.group) last.rows.push(row);
      else runs.push({ group: row.group, rows: [row] });
    }
    return runs.map(({ group, rows: run }) => (
      <BaseSettingsCard key={group ?? "rows"} title={group && GROUPS[group]}>
        {run.map(rowOf)}
        {group === "links" && links}
      </BaseSettingsCard>
    ));
  };

  const content: Record<SectionId, ReactNode> = {
    network: (
      <>
        <BaseSettingsCard>
          <NetworkSection />
        </BaseSettingsCard>
        {cardsOf("network", <ExplorerLinks phone={phone} />)}
      </>
    ),
    assistant: (
      <BaseSettingsCard>
        <BaseAssistantStatus hosted={hosted} phone={phone} />
      </BaseSettingsCard>
    ),
    editor: cardsOf("editor"),
    build: cardsOf("build"),
    wallet: cardsOf("wallet"),
    appearance: cardsOf("appearance"),
    shortcuts: <BaseShortcuts mac={PgCommon.getOS() === "MacOS"} />,
    project: (
      <BaseSettingsCard>
        <Project phone={phone} onImported={() => onClose("import")} />
      </BaseSettingsCard>
    ),
    advanced: (
      <>
        {cardsOf("advanced")}
        <BaseSettingsCard title={GROUPS.key}>
          <AssistantKey phone={phone} />
        </BaseSettingsCard>
      </>
    ),
  };

  const sections: SettingsSection[] = SECTION_ORDER.filter(
    // A phone has no keyboard for the shortcuts
    (id) => !(phone && id === "shortcuts")
  ).map((id) => ({
    id,
    title: sectionTitle(id),
    description: SECTION_DESCRIPTIONS[id],
    icon: ICONS[id],
    content: <div className="flex flex-col gap-6">{content[id]}</div>,
  }));

  return (
    <BaseSettingsPage
      sections={sections}
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

/** Row buttons on a phone: a fingertip tall in the control type */
const PHONE_BUTTON = "h-11 flex-1 rounded-lg text-control font-act";

interface ProjectProps {
  phone: boolean;
  /** A project was imported and opened: the page gets out of its way */
  onImported: () => void;
}

/** Export and import as two rows of the Project card */
const Project = ({ phone, onImported }: ProjectProps) => {
  const open = (dialog: typeof ImportGithub | typeof ImportFs) => async () => {
    if (isImported(await PgView.setModal(dialog))) onImported();
  };
  const size = phone ? "default" : "sm";
  return (
    <>
      {/* Names what Export takes: the page shows no other sign of it (HOO-2691) */}
      <OpenProjectLine phone={phone} />
      <BaseSettingRow
        name="Export project"
        description="Every file as a zip."
        phone={phone}
        control={<ExportProject className={phone ? PHONE_BUTTON : undefined} />}
      />
      <BaseSettingRow
        name="Import"
        description="Open a project from GitHub or your computer."
        phone={phone}
        control={
          <div className="flex w-full justify-end gap-2">
            <AsyncButton
              variant="outline"
              size={size}
              className={phone ? PHONE_BUTTON : undefined}
              aria-label="Import from GitHub"
              onClick={open(ImportGithub)}
              onError={reportButtonFailure("open the GitHub import")}
            >
              <Github data-icon="inline-start" />
              GitHub
            </AsyncButton>
            <AsyncButton
              variant="outline"
              size={size}
              className={phone ? PHONE_BUTTON : undefined}
              aria-label="Import from files"
              onClick={open(ImportFs)}
              onError={reportButtonFailure("open the file import")}
            >
              <Icon name="import" data-icon="inline-start" />
              Files
            </AsyncButton>
          </div>
        }
      />
    </>
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
      description="Your wallet and program in the block explorer."
      phone={phone}
      control={
        <div className="flex flex-wrap justify-end gap-3 text-caption">
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
