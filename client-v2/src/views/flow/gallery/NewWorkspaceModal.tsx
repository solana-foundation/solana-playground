import { NewProject, useNewProject } from "@/widgets/catalog";
import type { CatalogPage } from "@/widgets/catalog";
import { ModalFrame, useModalId } from "@/widgets/overlays";
import { PgView } from "@/utils/view";

/** Which of New project's two lists shows first */
export type GalleryTab = CatalogPage;

/**
 * The "What do you want to build?" dialog: the entry point for a new
 * project. The content is `widgets/catalog`'s `NewProject`; this wrapper
 * stays here because a widget may not import `widgets/overlays`, and it is
 * what `PgView.setModal` opens, which fires `PgView.onDidOpenModal` (the
 * left Sheet closes on it). New project's state is held here, above the
 * frame, so a dialog stacked on this one does not reset it, and New project
 * closes this dialog by its id, never whichever is on top.
 */
const NewWorkspaceModal = ({
  initialTab = "tutorials",
}: {
  initialTab?: GalleryTab;
}) => {
  const id = useModalId();
  const project = useNewProject(() => PgView.closeModal(null, id), initialTab);
  return (
    <ModalFrame
      name="new-workspace"
      title="What do you want to build?"
      size="wide"
      // The prototype opens it with nothing ringed: the name is one choice
      // among the catalogue's, not the dialog's question
      openFocus="dialog"
    >
      <NewProject project={project} />
    </ModalFrame>
  );
};

export default NewWorkspaceModal;
