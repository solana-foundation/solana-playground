import Primary from "../../../app/Panels/Main/Primary";

/**
 * The write stage hosts the upstream `Primary` panel, which is what `PgView`
 * targets for the Home page, `EditorWithTabs`, tutorial pages and share
 * pages. Mounting `EditorWithTabs` directly here would break every route
 * that isn't an open workspace.
 */
const Write = () => <Primary />;

export default Write;
