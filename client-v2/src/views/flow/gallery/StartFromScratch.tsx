import { FC, useState } from "react";
import styled, { css } from "styled-components";

import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import Img from "../../../components/Img";
import Input from "../../../components/Input";
import GradientButton from "../../../components/GradientButton";
import { PgExplorer, PgFramework, PgView, PgTheme } from "../../../utils";

/**
 * The gallery's one decisive action: pick a framework, name the project,
 * go. Mirrors the existing "Create workspace" modal's mechanism exactly
 * (`views/sidebar/explorer/Component/Modals/CreateWorkspace.tsx`) --
 * `PgFramework.get(name).getDefaultFiles()` then `PgExplorer.createWorkspace`
 * -- just laid out as a single row instead of a full-page form.
 */
const StartFromScratch: FC<React.PropsWithChildren<unknown>> = () => {
  const [framework, setFramework] = useState<FrameworkName | undefined>(
    PgFramework.all[0]?.name
  );
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const create = async () => {
    if (!framework) return;

    const projectName = name.trim() || defaultName(framework);
    if (!PgExplorer.isWorkspaceNameValid(projectName)) {
      setError("Invalid project name");
      return;
    }

    try {
      const { getDefaultFiles, defaultOpenFile } = PgFramework.get(framework);
      const { files } = await getDefaultFiles();
      await PgExplorer.createWorkspace(projectName, {
        files,
        defaultOpenFile,
      });
      PgView.setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project");
    }
  };

  return (
    <Row>
      <Plus aria-hidden="true">+</Plus>

      <Text>
        <Eyebrow>Blank canvas</Eyebrow>
        <Title>Start from scratch</Title>
        <Sub>A working starter you shape with the assistant.</Sub>
      </Text>

      <Segmented
        variant="gradient"
        aria-label="Framework"
        value={framework}
        onValueChange={(f) => setFramework(f as FrameworkName)}
      >
        {PgFramework.all.map((f) => (
          <SegmentedItem key={f.name} value={f.name}>
            <FrameworkIcon src={f.icon} $circle={f.circleImage} />
            {f.name}
          </SegmentedItem>
        ))}
      </Segmented>

      <Controls>
        {/* `Input` renders `error` as a message above itself, so a creation
            failure (e.g. a duplicate name) surfaces right at the field. */}
        <NameInput
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          error={error}
          setError={setError}
          placeholder={framework ? defaultName(framework) : "project name"}
          aria-label="Project name"
        />
        <GradientButton
          kind="primary"
          disabled={!!error || !framework}
          onClick={create}
        >
          Start &rarr;
        </GradientButton>
      </Controls>
    </Row>
  );
};

export default StartFromScratch;

const defaultName = (framework: FrameworkName) =>
  `${framework.toLowerCase()}-project`;

const Row = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid ${PgTheme.alpha(theme.colors.default.primary, "medium")};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
  `}
`;

const Plus = styled.span`
  ${({ theme }) => css`
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    border: 1px solid ${theme.colors.default.border};
    border-radius: 50%;
    color: ${theme.colors.default.primary};
    font-size: 1.25rem;
    line-height: 1;
  `}
`;

const Text = styled.div`
  flex: 1 1 12rem;
  min-width: 0;
`;

const Eyebrow = styled.div`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.xsmall};
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${theme.colors.default.primary};
  `}
`;

const Title = styled.div`
  ${({ theme }) => css`
    margin-top: 0.125rem;
    font-weight: 600;
    color: ${theme.colors.default.textPrimary};
  `}
`;

const Sub = styled.div`
  ${({ theme }) => css`
    margin-top: 0.125rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.other.size.small};
  `}
`;

const FrameworkIcon = styled(Img)<{ $circle?: boolean }>`
  width: 1.125rem;
  height: 1.125rem;
  border-radius: ${({ $circle }) => ($circle ? "50%" : "0.25rem")};
`;

const Controls = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
`;

const NameInput = styled(Input)`
  ${({ theme }) => css`
    width: 12rem;
    padding: 0.5rem 0.75rem;

    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 1px;
    }
  `}
`;
