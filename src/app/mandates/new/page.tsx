import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
import { NewMandate } from "@/components/mandate-workspace";
export default async function NewMandatePage() {
  const { organizationId } = await acquisitionSession();
  return <NewMandate mandates={await new AcquisitionRepository(organizationId).listMandates()} />;
}
