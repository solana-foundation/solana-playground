import { FC, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import { Button } from "@/shared/ui/button";
import Card from "../../Card";
import Img from "../../Img";
import Link from "../../Link";
import { getSrc } from "./platform-icon";
import { ResourceProps, RESOURCES } from "./resources";
import { TutorialProps, TUTORIALS } from "./tutorials";
import { External, ShortArrow } from "../../Icons";
import { PROJECT_NAME } from "../../../constants";
import { cn } from "@/shared/lib/utils";
import { PgFramework, PgView } from "../../../utils";

const Home = () => {
  // This prevents unnecessarily fetching the home content for a frame when the
  // app is first mounted
  const [resources, setResources] = useState<ResourceProps[]>();
  useEffect(() => {
    setResources(
      PgFramework.all
        .filter((f) => f.docs)
        .map((f) => ({ ...f, ...f.docs } as ResourceProps))
        .concat(RESOURCES)
    );
  }, []);

  if (!resources) return null;

  return (
    <div
      id={PgView.ids.HOME}
      className="h-full bg-surface-panel px-[8%] font-sans"
    >
      <div className="p-8 text-center font-heading text-[2.25rem] font-bold tracking-[-0.01em] text-[var(--text-secondary)]">
        {PROJECT_NAME}
      </div>

      <div className="flex w-full flex-wrap">
        <div className="max-w-[53rem]">
          <div className="mb-4 text-[1.25rem] font-bold">Resources</div>
          <div className="flex flex-wrap gap-8">
            {resources.map((r, i) => (
              <Resource key={i} {...r} />
            ))}
          </div>
        </div>

        <div className="max-w-[27rem] min-w-[16rem]">
          <div className="mb-4 text-[1.25rem] font-bold">Tutorials</div>
          <div className="flex flex-col gap-4">
            {TUTORIALS.map((t, i) => (
              <Tutorial key={i} {...t} />
            ))}
          </div>

          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mt-4 text-primary"
          >
            <RouterLink to="/tutorials">
              Playground tutorials
              <ShortArrow data-icon="inline-end" />
            </RouterLink>
          </Button>
        </div>
      </div>
    </div>
  );
};

const Resource: FC<React.PropsWithChildren<ResourceProps>> = ({
  name,
  description,
  url,
  icon,
  circleImage,
}) => (
  <Card className="h-60 w-60 rounded-[16px] border border-border bg-surface-raised px-6 pt-4 pb-6">
    <div className="flex h-1/5 items-center text-[1rem] font-bold">
      <Img
        src={icon}
        className={cn("mr-2 h-5 w-5", circleImage && "rounded-full")}
      />
      {name}
    </div>
    <div className="h-3/5 text-[var(--text-secondary)]">{description}</div>
    <div className="h-1/5 w-full">
      <Button asChild variant="outline" className="w-full">
        <a href={url} target="_blank" rel="noopener noreferrer">
          Learn more
          <External data-icon="inline-end" />
        </a>
      </Button>
    </div>
  </Card>
);

const Tutorial: FC<React.PropsWithChildren<TutorialProps>> = ({
  title,
  url,
}) => {
  const src = getSrc(url);

  return (
    <Link href={url}>
      <Card className="flex items-center rounded-[16px] border border-border bg-surface-raised">
        {src && <Img src={src} className="mr-3 h-4" />}
        <span>{title}</span>
      </Card>
    </Link>
  );
};

export default Home;
