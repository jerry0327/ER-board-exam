"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  children: ReactNode;
  portal: boolean;
};

export default function ReadingCatalogLayer({ children, portal }: Props) {
  if (!portal || typeof document === "undefined") return children;
  return createPortal(children, document.body);
}
