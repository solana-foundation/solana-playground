import { FC, useMemo } from "react";
import styled, { css } from "styled-components";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { Switch } from "@/shared/ui/switch";
import { HelpTip } from "@/shared/ui/help-tip";
import { useRenderOnChange } from "../../../../hooks";
import {
  PgCommon,
  PgSettings,
  PgTheme,
  PgView,
  RequiredKey,
  Setting as SettingType,
} from "../../../../utils";
import { CustomSetting } from "./CustomSetting";

const Settings = () => (
  <Wrapper>
    {PgSettings.all
      .reduce((acc, cur) => {
        const groupName = cur.id.split(".")[0];
        const lastGroup = acc.at(-1);
        if (lastGroup?.name === groupName) lastGroup!.settings.push(cur);
        else acc.push({ name: groupName, settings: [cur] });

        return acc;
      }, [] as SettingGroupProps[])
      .map((group) => {
        group.settings.sort((a, b) => {
          // Prioritize select components over checkboxes
          if (a.values && !b.values) return -1;
          if (b.values && !a.values) return 1;

          // Alphabetically order based on UI name
          return a.name.localeCompare(b.name);
        });

        return group;
      })
      .map((group) => (
        <SettingGroup key={group.name} {...group} />
      ))}
  </Wrapper>
);

const Wrapper = styled.div`
  ${({ theme }) => css`
    min-width: calc(
      ${theme.views.sidebar.left.default.width} +
        ${theme.views.sidebar.right.default.initialWidth}
    );
    min-height: 10rem;
    max-height: clamp(20rem, 40rem, 80vh);
    background: ${theme.components.tooltip.bg};
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    box-shadow: ${theme.default.boxShadow};
    overflow: auto;
    ${PgTheme.getScrollbarCSS({ width: "0.25rem" })};
  `}
`;

type SettingGroupProps = {
  name: string;
  settings: SettingType[];
};

const SettingGroup: FC<React.PropsWithChildren<SettingGroupProps>> = ({
  name,
  settings,
}) => (
  <SettingGroupWrapper>
    <Collapsible defaultOpen>
      <CollapsibleHeading>
        <CollapsibleChevron />
        {PgCommon.toTitleFromCamel(name).replace("Ui", "UI")}
      </CollapsibleHeading>
      <CollapsibleContent className="mt-2">
        {settings.map((setting) => (
          <Setting key={setting.id} {...setting} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  </SettingGroupWrapper>
);

const SettingGroupWrapper = styled.div`
  ${({ theme }) => css`
    padding: 1rem;
    max-width: calc(
      ${theme.views.sidebar.left.default.width} +
        ${theme.views.sidebar.right.default.initialWidth}
    );

    &:not(:last-child) {
      border-bottom: 1px solid ${theme.colors.default.border};
    }
  `}
`;

const Setting: FC<React.PropsWithChildren<SettingType>> = (setting) => (
  <SettingWrapper isCheckBox={!setting.values}>
    <Left>
      <SettingName>{setting.name}</SettingName>
      {setting.description && <HelpTip>{setting.description}</HelpTip>}
    </Left>

    <Right>
      <SettingSetter {...setting} />
    </Right>
  </SettingWrapper>
);

const SettingWrapper = styled.div<{ isCheckBox: boolean }>`
  ${({ isCheckBox }) => css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0 0.5rem 0.25rem;

    ${!isCheckBox &&
    `& > div:last-child {
      width: 11.5rem;
    }`}
  `}
`;

const Left = styled.div`
  display: flex;
  align-items: center;

  & > :nth-child(2) {
    margin-left: 0.5rem;
  }
`;

const SettingName = styled.span`
  color: ${({ theme }) => theme.colors.default.textSecondary};
`;

const Right = styled.div`
  margin-left: 1rem;
`;

type SettingSetterProps = SettingType;

const SettingSetter: FC<React.PropsWithChildren<SettingSetterProps>> = ({
  values,
  ...props
}) => {
  useRenderOnChange(props.onChange);
  if (values) return <SettingSetterSelect values={values} {...props} />;
  return <SettingSetterCheckBox {...props} />;
};

type SettingSetterSelectProps = RequiredKey<SettingSetterProps, "values">;

type Option = { label: string; value: string };
type Group = { label: string; options: Option[] };
type Entry = Option | Group;

const isGroup = (e: Entry): e is Group => "options" in e;

/**
 * Stands for the "Custom" row. An empty string cannot, because Radix refuses
 * an item with an empty value and no setting may have one as its default.
 */
const CUSTOM_VALUE = "__custom__";

export const SettingSetterSelect: FC<
  React.PropsWithChildren<SettingSetterSelectProps>
> = (setting) => {
  const entries = useMemo(() => {
    const entries: Entry[] = PgCommon.callIfNeeded(setting.values).map(
      convertValue
    );
    if (setting.custom) entries.push({ label: "Custom", value: CUSTOM_VALUE });

    return entries;
  }, [setting.values, setting.custom]);

  const value =
    findOption(entries, setting.getValue())?.value ??
    (setting.custom ? CUSTOM_VALUE : undefined);

  const openCustom = () => {
    if (setting.custom?.Component) PgView.setModal(setting.custom.Component);
    else PgView.setModal(<CustomSetting setting={setting} />);
  };

  const renderOption = (o: Option) => {
    // Picking the row that is already selected fires no `onValueChange`, yet
    // `CustomSetting` is how the user edits the custom value they have, and
    // the old select reopened it. So the current Custom row opens the modal
    // itself, on pointer and on Enter/Space. Any other pick goes through
    // `onValueChange`, so the two paths never both run.
    const reopens = o.value === CUSTOM_VALUE && value === CUSTOM_VALUE;
    return (
      <SelectItem
        key={o.value}
        value={o.value}
        onPointerUp={reopens ? openCustom : undefined}
        onKeyDown={
          reopens
            ? (ev) => {
                if (ev.key === "Enter" || ev.key === " ") openCustom();
              }
            : undefined
        }
      >
        {o.label}
      </SelectItem>
    );
  };

  return (
    <Select
      // A stored value no option has, and no Custom row to stand for it:
      // `""` keeps the select controlled and shows the empty trigger, where
      // `undefined` would hand the value to Radix's own state
      value={value ?? ""}
      onValueChange={(v) => {
        if (v === CUSTOM_VALUE) openCustom();
        else setting.setValue(v);
      }}
    >
      <SelectTrigger aria-label={setting.name} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {entries.map((e) =>
          isGroup(e) ? (
            <SelectGroup key={e.label}>
              <SelectLabel>{e.label}</SelectLabel>
              {e.options.map(renderOption)}
            </SelectGroup>
          ) : (
            renderOption(e)
          )
        )}
      </SelectContent>
    </Select>
  );
};

/**
 * Convert the setting value to make it compatible with the `Select` component.
 *
 * @param v the value to convert
 * @returns the converted value
 */
const convertValue = (v: any): Entry => {
  if (typeof v === "object") {
    if (v.value) return { label: v.name, value: v.value };
    if (v.values) return { label: v.name, options: v.values.map(convertValue) };
    throw new Error(`Invalid option value: ${v}`);
  }

  return { label: PgCommon.toTitleFromKebab(v), value: v };
};

/**
 * Recursively try to find the option based on the value set.
 *
 * @param entries options and groups
 * @param v value
 * @returns the option if found
 */
const findOption = (entries: Entry[], v: unknown): Option | undefined => {
  for (const entry of entries) {
    if (isGroup(entry)) {
      const res = findOption(entry.options, v);
      if (res) return res;
    } else if (entry.value === v) {
      return entry;
    }
  }
};

type SettingSetterCheckBoxProps = Omit<SettingSetterProps, "values">;

const SettingSetterCheckBox: FC<
  React.PropsWithChildren<SettingSetterCheckBoxProps>
> = ({ name, getValue, setValue }) => (
  <Switch
    aria-label={name}
    checked={getValue()}
    onCheckedChange={(checked) => setValue(checked)}
  />
);

export default Settings;
