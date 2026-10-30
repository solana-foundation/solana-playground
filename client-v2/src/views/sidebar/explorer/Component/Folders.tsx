import {
  cloneElement,
  ComponentPropsWithoutRef,
  CSSProperties,
  FC,
  forwardRef,
  MouseEvent,
  ReactElement,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/shared/lib/utils";

import ExplorerButtons from "./ExplorerButtons";
import Dnd, { DragStartEvent, DragEndEvent } from "../../../../components/Dnd";
import LangIcon from "../../../../components/LangIcon";
import { ExplorerContextMenu } from "./ExplorerContextMenu";
import { ReplaceItem } from "./Modals";
import {
  Plus,
  Rocket,
  ShortArrow,
  TestTube,
  Triangle,
  Wrench,
} from "../../../../components/Icons";
import { PgCommon, PgExplorer, PgView, PgTheme } from "../../../../utils";
import { useCreateItem } from "./useCreateItem";
import { useExplorerContextMenu } from "./useExplorerContextMenu";
import { useResetCtxSelected } from "./useResetCtxSelected";
import { useHandleItemState } from "./useHandleItemState";
import { useKeybind } from "../../../../hooks";
import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

/*
 * The rows are styled from the root, on the class names `PgExplorer` toggles
 * in the DOM (`selected`, `ctx-selected`), so the runtime toggling restyles
 * them. Nothing in a row gives: text will not compress below its own width,
 * so a flex row with a long name would take the slack out of the indent and
 * the chevron instead, and a deeply nested folder would lose the control that
 * expands it. Names are never shortened either; a row wider than the panel
 * scrolls it rather than hiding characters.
 */
const ROOT_CLASSES = cn(
  "py-1.5",
  "[&_:is(.folder,.file)]:mx-1.5 [&_:is(.folder,.file)]:flex [&_:is(.folder,.file)]:items-center",
  "[&_:is(.folder,.file)]:cursor-pointer [&_:is(.folder,.file)]:rounded-[0.5rem]",
  "[&_:is(.folder,.file)]:border [&_:is(.folder,.file)]:border-transparent",
  "[&_:is(.folder,.file)]:px-2.5 [&_:is(.folder,.file)]:py-[0.3125rem] [&_:is(.folder,.file)]:text-[0.75rem]",
  "[&_:is(.folder,.file).selected]:bg-[color-mix(in_srgb,var(--primary)_9%,transparent)]",
  "[&_:is(.folder,.file).ctx-selected]:bg-[color-mix(in_srgb,var(--primary)_9%,transparent)] [&_:is(.folder,.file).ctx-selected]:border-[color-mix(in_srgb,var(--primary)_39%,transparent)] [&_:is(.folder,.file).ctx-selected]:rounded-[12px]",
  "[&_:is(.folder,.file):hover]:bg-[color-mix(in_srgb,var(--primary)_9%,transparent)]",
  "[&_:is(.folder,.file)>*]:shrink-0 [&_:is(.folder,.file)>span]:whitespace-nowrap"
);

const SECTION_TOP_CLASSES =
  "mb-1 ml-4 flex items-center text-[color:var(--text-secondary)] not-first:mt-4 [&>button]:ml-2 [&>button:nth-child(2)]:ml-3";

const SECTION_HEADER_CLASSES =
  "text-[0.7rem] font-semibold tracking-[0.1em] uppercase";

const Folders = () => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useHandleItemState(wrapperRef);

  const ctxMenu = useExplorerContextMenu();
  const { createItem } = useCreateItem();

  useKeybind(
    [
      { keybind: "Alt+N", handle: createItem },
      { keybind: "F2", handle: ctxMenu.renameItem },
      { keybind: "Delete", handle: ctxMenu.deleteItem },
    ],
    []
  );

  useResetCtxSelected(wrapperRef);

  // No need to memoize here
  const relativeRootPath = PgExplorer.getProjectRootPath();
  const { folders } = PgExplorer.getFolderContent(relativeRootPath);
  const otherFolders = folders.filter(
    (f) =>
      f !== PgExplorer.PATHS.SRC_DIRNAME &&
      f !== PgExplorer.PATHS.CLIENT_DIRNAME &&
      f !== PgExplorer.PATHS.TESTS_DIRNAME
  );

  return (
    <>
      <ExplorerButtons />

      <ExplorerDndContext>
        <ExplorerContextMenu {...ctxMenu}>
          <div
            ref={wrapperRef}
            className={ROOT_CLASSES}
            id={PgView.ids.ROOT_DIR}
            data-path={relativeRootPath}
          >
            {/* Program */}
            <div className={SECTION_TOP_CLASSES} data-section>
              <div className={SECTION_HEADER_CLASSES}>Program</div>
              {folders.includes(PgExplorer.PATHS.SRC_DIRNAME) ? (
                <>
                  <SectionButton
                    onClick={ctxMenu.runBuild}
                    failureAction="build"
                    disabled={ctxMenu.buildLoading}
                    icon={<Wrench />}
                  >
                    Build
                  </SectionButton>
                  <SectionButton
                    onClick={ctxMenu.runDeploy}
                    failureAction="deploy"
                    disabled={ctxMenu.deployState !== "ready"}
                    icon={<Rocket />}
                  >
                    Deploy
                  </SectionButton>
                </>
              ) : (
                <SectionButton
                  onClick={ctxMenu.addProgram}
                  failureAction="add a program"
                  icon={<Plus />}
                >
                  Add
                </SectionButton>
              )}
            </div>
            <FolderGroup
              folders={folders.filter(
                (f) => f === PgExplorer.PATHS.SRC_DIRNAME
              )}
              relativeRootPath={relativeRootPath}
            />

            {/* Client and tests */}
            <div className={SECTION_TOP_CLASSES} data-section>
              <div className={SECTION_HEADER_CLASSES}>Client</div>
              {folders.includes(PgExplorer.PATHS.CLIENT_DIRNAME) ? (
                <SectionButton
                  onClick={ctxMenu.runClientFolder}
                  failureAction="run the client"
                  icon={<Triangle rotate="90deg" />}
                  title="Run All (in client dir)"
                >
                  Run
                </SectionButton>
              ) : (
                <SectionButton
                  onClick={ctxMenu.addClient}
                  failureAction="add a client"
                  icon={<Plus />}
                >
                  Add client
                </SectionButton>
              )}

              {folders.includes(PgExplorer.PATHS.TESTS_DIRNAME) ? (
                <SectionButton
                  onClick={ctxMenu.runTestFolder}
                  failureAction="run the tests"
                  icon={<TestTube />}
                  title="Test All (in tests dir)"
                >
                  Test
                </SectionButton>
              ) : (
                <SectionButton
                  onClick={ctxMenu.addTests}
                  failureAction="add tests"
                  icon={<Plus />}
                >
                  Add tests
                </SectionButton>
              )}
            </div>
            <FolderGroup
              folders={folders.filter(
                (f) =>
                  f === PgExplorer.PATHS.CLIENT_DIRNAME ||
                  f === PgExplorer.PATHS.TESTS_DIRNAME
              )}
              relativeRootPath={relativeRootPath}
            />

            {/* Other */}
            {otherFolders.length > 0 && (
              <div className={SECTION_TOP_CLASSES} data-section>
                <div className={SECTION_HEADER_CLASSES}>Other</div>
              </div>
            )}
            <FolderGroup
              folders={otherFolders}
              relativeRootPath={relativeRootPath}
            />
          </div>
        </ExplorerContextMenu>
      </ExplorerDndContext>
    </>
  );
};

const ExplorerDndContext: FC<React.PropsWithChildren<unknown>> = ({
  children,
}) => {
  const [activeItemProps, setActiveItemProps] = useState<any>(null);
  const [parentFolderEl, setParentFolderEl] = useState<HTMLElement | null>(
    null
  );

  const handleDragStart = useCallback((ev: DragStartEvent) => {
    const props: any = ev.active.data.current;
    const el = PgExplorer.getElFromPath(props.path);
    if (!el) return;

    // Get the class name from the element to persist the folder open state
    setActiveItemProps({ ...props, className: el.className });
    setParentFolderEl(el.parentElement!);
  }, []);

  const handleDragEnd = useCallback(async (ev: DragEndEvent) => {
    const { active, over } = ev;
    if (!over) return;

    const fromPath = active.id as string;
    const toPath = over.id as string;
    if (PgCommon.isPathsEqual(fromPath, toPath)) return;

    // Destination should be a folder
    const isToPathFolder = PgExplorer.getItemTypeFromPath(toPath).folder;
    if (!isToPathFolder) return;

    // Should not be able to move parent dir into child
    const isFromPathFolder = PgExplorer.getItemTypeFromPath(fromPath).folder;
    if (isFromPathFolder && toPath.startsWith(fromPath)) return;

    const itemName = PgExplorer.getItemNameFromPath(fromPath);
    const newPath = PgExplorer.getCanonicalPath(
      PgCommon.joinPaths(toPath, itemName)
    );
    if (PgCommon.isPathsEqual(fromPath, newPath)) return;

    try {
      await PgExplorer.renameItem(fromPath, newPath, {
        skipNameValidation: true,
      });
    } catch (e: any) {
      if (e.message === PgExplorer.errors.ALREADY_EXISTS) {
        await PgView.setModal(
          <ReplaceItem fromPath={fromPath} toPath={newPath} />
        );
      }
    }
  }, []);

  const Item = activeItemProps
    ? PgExplorer.getItemTypeFromPath(activeItemProps.path).file
      ? File
      : Folder
    : null;

  return (
    <Dnd.Context
      dragOverlay={{
        Element: Item && <Item {...activeItemProps} />,
        portalContainer: parentFolderEl,
        dropAnimation: null,
      }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}
    </Dnd.Context>
  );
};

interface SectionButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof AsyncButton>, "onError"> {
  icon: ReactElement<{ "data-icon"?: string }>;
  /** What did not happen when the click fails, completing "Could not …" */
  failureAction: string;
}

const SectionButton: FC<SectionButtonProps> = ({
  icon,
  failureAction,
  children,
  className,
  ...props
}) => (
  <AsyncButton
    variant="ghost"
    size="xs"
    className={cn("text-muted-foreground hover:text-foreground", className)}
    onError={reportButtonFailure(failureAction)}
    {...props}
  >
    {/* Each icon spreads its props onto its <svg>, which is how the data-icon
        reaches the element the button sizes */}
    {cloneElement(icon, { "data-icon": "inline-start" })}
    {children}
  </AsyncButton>
);

interface FolderGroupProps {
  folders: string[];
  relativeRootPath: string;
}

const FolderGroup: FC<React.PropsWithChildren<FolderGroupProps>> = ({
  folders,
  relativeRootPath,
}) => (
  <>
    {folders
      .sort((a, b) => a.localeCompare(b))
      .map((folderName) => (
        <RecursiveFolder
          key={folderName}
          path={PgCommon.appendSlash(
            PgCommon.joinPaths(relativeRootPath, folderName)
          )}
        />
      ))}
  </>
);

interface RecursiveFolderProps {
  path: string;
}

const RecursiveFolder: FC<React.PropsWithChildren<RecursiveFolderProps>> = ({
  path,
}) => {
  const folderName = useMemo(
    () => PgExplorer.getItemNameFromPath(path),
    [path]
  );
  const depth = useMemo(
    () => PgExplorer.getRelativePath(path).split("/").length - 2,
    [path]
  );

  // Intentionally don't memoize in order to re-render
  const { files, folders } = PgExplorer.getFolderContent(path);

  const toggle = useCallback((ev: MouseEvent<HTMLDivElement>) => {
    const el = ev.currentTarget;
    // Set selected
    PgExplorer.setSelectedEl(el);
    PgExplorer.setCtxSelectedEl(el);

    if (PgExplorer.getItemTypeFromEl(el)?.folder) {
      PgExplorer.toggleFolder(el);
    } else {
      PgExplorer.openFile(PgExplorer.getItemPathFromEl(el)!);
    }
  }, []);

  // Open the folder on drag over
  const handleDragOver = useCallback((el: HTMLElement) => {
    PgExplorer.openFolder(el.firstChild as HTMLDivElement);
  }, []);

  const theme = usePgTheme();
  const overStyle: CSSProperties = useMemo(
    () => ({
      background: PgTheme.alpha(theme.colors.default.primary, "low"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme.name]
  );

  return (
    <Dnd.Droppable id={path} onDragOver={handleDragOver} overStyle={overStyle}>
      <Dnd.Draggable
        id={path}
        Item={Folder}
        itemProps={{
          path,
          name: folderName,
          depth,
          onClick: toggle,
          className: PgView.classNames.FOLDER,
        }}
      />

      <div
        className={cn(
          PgView.classNames.FOLDER_INSIDE,
          PgView.classNames.HIDDEN,
          "[&.hidden]:hidden"
        )}
      >
        {folders
          .sort((a, b) => a.localeCompare(b))
          .map((folderName) => (
            <RecursiveFolder
              key={folderName}
              path={PgCommon.appendSlash(PgCommon.joinPaths(path, folderName))}
            />
          ))}

        {files
          .sort((a, b) => a.localeCompare(b))
          .map((fileName) => (
            <Dnd.Draggable
              key={fileName}
              id={PgCommon.joinPaths(path, fileName)}
              Item={File}
              itemProps={{
                path: PgCommon.joinPaths(path, fileName),
                name: fileName,
                depth: depth + 1,
                onClick: toggle,
                className: PgView.classNames.FILE,
              }}
            />
          ))}
      </div>
    </Dnd.Droppable>
  );
};

interface FileOrFolderProps {
  path: string;
  name: string;
  depth: number;
}

type FolderProps = FileOrFolderProps & ComponentPropsWithoutRef<"div">;

const Folder = forwardRef<HTMLDivElement, FolderProps>(
  ({ path, name, depth, className, ...props }, ref) => (
    <div
      ref={ref}
      data-path={path}
      className={cn(
        // The chevron: sized and turned from the row, as `ShortArrow` takes
        // no class
        "[&_svg]:size-[0.875rem] [&_svg]:[transition:transform_50ms_linear]",
        "[&.open_svg]:[transform:rotate(90deg)]",
        className
      )}
      {...props}
    >
      <div className="h-full" style={{ width: `${depth}rem` }} />
      <ShortArrow color="textSecondary" />
      <span className="ml-2 text-primary">{name}</span>
    </div>
  )
);

type FileProps = FileOrFolderProps & ComponentPropsWithoutRef<"div">;

const File = forwardRef<HTMLDivElement, FileProps>(
  ({ path, name, depth, className, ...props }, ref) => (
    <div
      ref={ref}
      data-path={path}
      className={cn("[&_img]:ml-0.5", className)}
      {...props}
    >
      <div className="h-full" style={{ width: `${depth}rem` }} />
      <LangIcon path={path} />
      <span className="ml-1.5 text-[color:var(--text-primary)]">{name}</span>
    </div>
  )
);

export default Folders;
