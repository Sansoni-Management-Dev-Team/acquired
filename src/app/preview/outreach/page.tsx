import { notFound } from "next/navigation";
import { OutreachStudioPrototype } from "@/components/outreach-studio-prototype";

export default function OutreachPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <OutreachStudioPrototype mandateName="Sample acquisition mandate" />;
}
