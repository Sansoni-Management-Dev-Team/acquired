import { notFound } from "next/navigation";
import { MandatePicker } from "@/components/cached-mandate-pages";

export function generateStaticParams() {
  return ["brief", "targets", "people", "sequences"].map(section => ({ section }));
}

export default async function MandateSelectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section !== "brief" && section !== "targets" && section !== "people" && section !== "sequences") notFound();
  return <MandatePicker section={section} />;
}
