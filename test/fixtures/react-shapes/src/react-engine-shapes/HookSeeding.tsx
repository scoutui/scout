import { Banner, useModalHolder } from "@example/react-ds";

// A component rendered only through a hook. `ConfirmModal` is passed
// to an external hook inside a custom hook; each page interpolates the
// product as `{modal}`, so nothing ever renders `<ConfirmModal/>` as a tag.
const ConfirmModal = () => <Banner />;

export const useConfirmModal = () => {
  const [modal, showModal] = useModalHolder(ConfirmModal);
  return [modal, showModal] as const;
};

export const HookPage = () => {
  const [modal, show] = useConfirmModal();
  return <div onClick={show}>{modal}</div>;
};
