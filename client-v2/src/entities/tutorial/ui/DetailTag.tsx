import { cn } from "@/shared/lib/utils";

import { createLogger } from "@/shared/lib/logger";
import Img from "../../../components/Img";
import LangIcon from "../../../components/LangIcon";
import { PgFramework, PgLanguage } from "../../../utils";
import { BaseDetailTag, type BaseDetailTagProps } from "./BaseDetailTag";

type DetailTagProps = {
  kind: BaseDetailTagProps["kind"];
  value: string;
  className?: string;
};

const log = createLogger("tutorial:detail-tag");

/** Unknown frameworks already reported, so a list of tags reports each once */
const reported = new Set<string>();

function DetailTag({ kind, value, className }: DetailTagProps) {
  // A framework whose image is a circle is drawn round; the box leaves icons
  // square
  const round =
    kind === "framework" &&
    PgFramework.get(value as FrameworkName)?.circleImage;
  return (
    <BaseDetailTag
      kind={kind}
      label={value}
      icon={iconOf(kind, value)}
      className={cn(round && "[&>img]:rounded-full", className)}
    />
  );
}

function iconOf(kind: string, value: string) {
  if (kind === "framework") {
    const framework = PgFramework.get(value as FrameworkName);
    if (!framework) {
      // An unknown framework shows its name alone
      if (!reported.has(value)) {
        reported.add(value);
        log.warn("tutorial names a framework the playground does not know", {
          report: true,
          context: { framework: value },
        });
      }
      return null;
    }
    return <Img src={framework.icon} />;
  }
  if (kind === "languages") {
    const extension = PgLanguage.all.find((l) => l.name === value)
      ?.extensions[0];
    return <LangIcon path={`file.${extension}`} />;
  }
  return null;
}

export { DetailTag };
