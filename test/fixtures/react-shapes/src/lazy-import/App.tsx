import { lazy } from "react";

const Page = lazy(() => import("@example/react-ds").then((m) => m.Button));
const dynamic = (fn: any) => fn;
const Sidebar = dynamic(() => import("@example/react-ds"));
const loadable = (fn: any) => fn;
const Modal = loadable(() => import("@example/react-ds").then((m) => m.Card));

export function App() {
  return (
    <>
      <Page />
      <Sidebar />
      <Modal />
    </>
  );
}
