import type React from "react";
import Head from "@docusaurus/Head";
import Layout from "@theme/Layout";
import { Close, SelfHosted } from "../components/landing/Closing";
import Hero from "../components/landing/Hero";
import Stages from "../components/landing/Stages";
import { PRODUCT_NAME } from "../components/landing/product";
import shared from "../components/landing/shared.module.css";

const TITLE = `${PRODUCT_NAME}: design-system usage analytics for React and Vue`;

export default function Home(): React.ReactElement {
  return (
    <Layout
      description={`${PRODUCT_NAME} scans React and Vue repos, web components included, for every component, prop value and call site, and a dashboard you host tracks migrations across every repo.`}
    >
      <Head>
        <title>{TITLE}</title>
        <meta property="og:title" content={TITLE} />
      </Head>
      <main className={shared.page}>
        <Hero />
        <Stages />
        <SelfHosted />
        <Close />
      </main>
    </Layout>
  );
}
