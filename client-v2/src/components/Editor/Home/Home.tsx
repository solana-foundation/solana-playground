import { ArrowUpRight, ChevronRight } from "lucide-react";
import { FC, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import { Button } from "@/shared/ui/button";

import { PROJECT_NAME } from "../../../constants";
import { PgFramework, PgView } from "../../../utils";
import { getSrc } from "./platform-icon";
import { ResourceProps, RESOURCES } from "./resources";
import { TutorialProps, TUTORIALS } from "./tutorials";

/**
 * The editor with no file open: where to read up and what to watch. One
 * column as wide as the new Home's (`BaseHome`), a heading per section, and
 * every card a link as a whole, so there is no "Learn more" to aim at.
 */
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
      className="h-full overflow-y-auto bg-surface font-read"
    >
      <div className="mx-auto flex w-full max-w-[50rem] flex-col gap-12 px-8 pt-16 pb-16">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-[1.75rem] leading-tight font-headline tracking-tight text-foreground">
            {PROJECT_NAME}
          </h1>
          <p className="text-body text-muted-foreground">
            Docs to read and videos to follow while you build on Solana.
          </p>
        </header>

        <section
          aria-labelledby="home-resources"
          className="flex flex-col gap-4"
        >
          <SectionTitle id="home-resources">Resources</SectionTitle>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {resources.map((r) => (
              <Resource key={r.name} {...r} />
            ))}
          </div>
        </section>

        <section
          aria-labelledby="home-tutorials"
          className="flex flex-col gap-4"
        >
          <SectionTitle id="home-tutorials">Tutorials</SectionTitle>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
            {TUTORIALS.map((t) => (
              <Tutorial key={t.url} {...t} />
            ))}
          </ul>
          <Button
            asChild
            variant="link"
            className="self-start px-0 text-foreground"
          >
            <RouterLink to="/tutorials">
              Playground tutorials
              <ChevronRight data-icon="inline-end" />
            </RouterLink>
          </Button>
        </section>
      </div>
    </div>
  );
};

const SectionTitle: FC<React.PropsWithChildren<{ id: string }>> = ({
  id,
  children,
}) => (
  <h2 id={id} className="font-heading text-control font-act text-foreground">
    {children}
  </h2>
);

/** Opens outside the Playground, so the arrow says it leaves */
const OUT = { target: "_blank", rel: "noopener noreferrer" } as const;

const Resource: FC<ResourceProps> = ({
  name,
  description,
  url,
  icon,
  circleImage,
}) => (
  <a
    href={url}
    {...OUT}
    className="group flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-4 transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
  >
    <span className="flex items-center gap-2.5">
      <img
        src={icon}
        alt=""
        className={
          circleImage
            ? "size-5 rounded-full object-contain"
            : "size-5 object-contain"
        }
      />
      <span className="flex-1 text-control font-act text-foreground">
        {name}
      </span>
      <ArrowUpRight
        aria-hidden
        className="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
      />
    </span>
    <span className="text-caption text-muted-foreground">{description}</span>
  </a>
);

const Tutorial: FC<TutorialProps> = ({ title, url }) => {
  const src = getSrc(url);

  return (
    <li>
      <a
        href={url}
        {...OUT}
        className="group flex min-h-12 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {src && (
            <img src={src} alt="" className="max-h-4 w-5 object-contain" />
          )}
        </span>
        <span className="flex-1 text-control text-foreground">{title}</span>
        <ArrowUpRight
          aria-hidden
          className="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </a>
    </li>
  );
};

export default Home;
