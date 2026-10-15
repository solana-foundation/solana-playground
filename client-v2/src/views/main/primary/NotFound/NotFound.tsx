import type { FC } from "react";
import styled from "styled-components";

import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import Text from "../../../../components/Text";
import { Error } from "../../../../components/Icons";
import { PgRouter } from "../../../../utils";

interface NotFoundProps {
  text?: string;
  navigate?: {
    name: string;
    path: RoutePath;
  };
}

const NotFound: FC<React.PropsWithChildren<NotFoundProps>> = ({
  text,
  navigate,
}) => (
  <Wrapper>
    <Text kind="error" icon={<Error />}>
      {text ?? `URL path not found: ${PgRouter.location.pathname}`}
    </Text>
    <AsyncButton
      variant="ghost"
      onClick={() => PgRouter.navigate(navigate?.path)}
      onError={reportButtonFailure}
    >
      {navigate?.name ?? "Go home"}
    </AsyncButton>
  </Wrapper>
);

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1rem;
`;

export default NotFound;
