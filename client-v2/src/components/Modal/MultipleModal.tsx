import { FC, useState } from "react";

export interface MultipleModalProps {
  /** Default page to show when the modal first mounts */
  defaultPage: Page;
}

type Page<P = any> = {
  Component: FC<React.PropsWithChildren<P>>;
  props?: Omit<P, keyof CommonModalPageProps>;
};

export type CommonModalPageProps = { setPage: <P>(page: Page<P>) => void };

const MultiModal: FC<React.PropsWithChildren<MultipleModalProps>> = ({
  defaultPage,
}) => {
  const [page, setPage] = useState<Page>(defaultPage);
  return <page.Component setPage={setPage} {...page.props} />;
};

export default MultiModal;
