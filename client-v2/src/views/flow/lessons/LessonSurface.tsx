import EditorWithTabs from "../../../components/EditorWithTabs";

/**
 * What a lesson shows in the main area: the editor, and nothing else.
 *
 * Upstream's `Tutorial` renders the editor beside a markdown pane, which
 * inside Flow would put the lesson text and the assistant on the same
 * edge. Flow supplies the lesson chrome itself -- steps in the rail, the
 * objective above the editor, the page in a reader -- so this surface
 * only has to be the code.
 */
const LessonSurface = () => <EditorWithTabs />;

export default LessonSurface;
