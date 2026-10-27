import { FC } from "react";
import styled from "styled-components";

import { ModalFrame } from "@/widgets/overlays";

interface ApproveProps {}

// TODO:
const Approve: FC<React.PropsWithChildren<ApproveProps>> = ({}) => {
  const handleApprove = () => {};

  return (
    <ModalFrame
      name="wallet-approve"
      title
      buttonProps={{ text: "Approve", onSubmit: handleApprove }}
    >
      <Content>Approve tx</Content>
    </ModalFrame>
  );
};

const Content = styled.div``;

export default Approve;
