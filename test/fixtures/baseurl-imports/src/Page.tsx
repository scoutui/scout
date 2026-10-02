import { memo } from "react";
// `"baseUrl": "."` with no `paths`: `app/Banner` names `<root>/app/Banner.tsx`.
import { Banner } from "app/Banner";

export const Page = memo(() => <Banner />);
