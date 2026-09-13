import type { Metadata } from "next";
import APWorkbench from "./APWorkbench";

export const metadata: Metadata = {
  title: "AP Desk | Bill exception review",
  description: "An Airwallex-powered accounts-payable exception review workbench.",
};

export default function Home() {
  return <APWorkbench />;
}
