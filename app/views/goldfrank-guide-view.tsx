"use client";

import type { ComponentProps } from "react";
import EmsGuideView from "./ems-guide-view";

type Props = Omit<ComponentProps<typeof EmsGuideView>, "sourceId">;

/** Goldfrank shares the chapter-reader system while keeping its own identity and persistence scope. */
export default function GoldfrankGuideView(props: Props) {
  return <EmsGuideView {...props} sourceId="goldfrank" />;
}
