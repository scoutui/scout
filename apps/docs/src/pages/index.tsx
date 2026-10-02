import type React from "react";
import Layout from "@theme/Layout";
import { Close, SelfHosted } from "../components/landing/Closing";
import Hero from "../components/landing/Hero";
import Stages from "../components/landing/Stages";
import { PRODUCT_NAME } from "../components/landing/product";
import shared from "../components/landing/shared.module.css";

export default function Home(): React.ReactElement {
  return (
    <Layout
      title="Design-system usage analytics for React and Vue"
      description={`${PRODUCT_NAME} scans React and Vue repos, web components included, for every component, prop value and call site, and a dashboard you host tracks migrations across every repo.`}
    >
      <main className={shared.page}>
        <Hero />
        <Stages />
        <SelfHosted />
        <Close />
      </main>
    </Layout>
  );
}
