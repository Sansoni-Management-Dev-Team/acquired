import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
import { MandateNavigation } from "@/components/mandate-workspace";
import { HomeMandateCreate } from "@/components/home-mandate-create";
export default async function NewMandatePage() {
  const { organizationId } = await acquisitionSession();
  const mandates = await new AcquisitionRepository(organizationId).listMandates();
  return <><MandateNavigation mandates={mandates} /><HomeMandateCreate mandates={mandates} /></>;
}
