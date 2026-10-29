import { FC } from "react";

import Link from "../Link";
import { DetailTag } from "@/entities/tutorial";
import { Arrayable, TutorialDetailKey } from "../../utils";

interface TutorialDetailsProps {
  details: ClickableTutorialDetailProps[];
}

const TutorialDetails: FC<React.PropsWithChildren<TutorialDetailsProps>> = ({
  details,
}) => (
  <div className="flex flex-wrap justify-between gap-x-8 gap-y-5 rounded-card border border-border bg-surface-panel p-5">
    {details.map(
      ({ kind, data }) =>
        data && (
          <div key={kind} className="flex flex-col gap-2.5">
            <span className="font-act text-caption tracking-wide text-foreground uppercase">
              {kind}
            </span>

            <div className="flex flex-wrap gap-4">
              {Array.isArray(data) ? (
                data.map((data) => (
                  <ClickableTutorialDetail key={data} kind={kind} data={data} />
                ))
              ) : (
                <ClickableTutorialDetail kind={kind} data={data} />
              )}
            </div>
          </div>
        )
    )}
  </div>
);

interface ClickableTutorialDetailProps {
  kind: TutorialDetailKey;
  data: Arrayable<string> | undefined;
}

const ClickableTutorialDetail: FC<
  React.PropsWithChildren<ClickableTutorialDetailProps>
> = ({ data, ...props }) => (
  <Link href={`/tutorials?${props.kind}=${data}`}>
    <DetailTag kind={props.kind} value={String(data)} />
  </Link>
);

export default TutorialDetails;
