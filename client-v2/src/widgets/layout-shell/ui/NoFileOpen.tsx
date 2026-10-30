import { PgView } from "@/utils/view";
import BaseNoFileOpen from "./BaseNoFileOpen";

/** `BaseNoFileOpen`, asking the shell for Files through `PgView.showFiles` */
const NoFileOpen = () => <BaseNoFileOpen onShowFiles={PgView.showFiles} />;

export default NoFileOpen;
