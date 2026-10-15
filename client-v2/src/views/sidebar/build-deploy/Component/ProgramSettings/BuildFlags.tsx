import styled from "styled-components";

import { Checkbox } from "@/shared/ui/checkbox";
import { HelpTip } from "@/shared/ui/help-tip";
import { Label } from "@/shared/ui/label";
import { PgCommon, PgSettings } from "../../../../../utils";

type BuildFlag = keyof typeof PgSettings["build"]["flags"];

const BUILD_FLAGS: { [K in BuildFlag]: string } = {
  noDocs: "Disable documentation in IDL",
  safetyChecks: "Require `/// CHECK:` comments for unchecked accounts",
  seedsFeature: "Include seeds in IDL",
};

const BuildFlags = () => (
  <Wrapper>
    {PgCommon.entries(BUILD_FLAGS).map(([flag, details]) => (
      <Row key={flag}>
        <Label className="flex items-center gap-2">
          <Checkbox
            defaultChecked={PgSettings.build.flags[flag]}
            onCheckedChange={(checked) => {
              PgSettings.build.flags[flag] = checked === true;
            }}
          />
          {PgCommon.toTitleFromCamel(flag)}
        </Label>
        <HelpTip>{details}</HelpTip>
      </Row>
    ))}
  </Wrapper>
);

const Wrapper = styled.div`
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const Row = styled.div`
  display: flex;
  gap: 0.5rem;
`;

export default BuildFlags;
