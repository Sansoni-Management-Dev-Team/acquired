import { readableStoredBrief } from "./stored-brief";
import { briefSchema, type AcquisitionBrief } from "./acquisition";
import savedExamples from "@/data/saved-test-mandates.json";
import newExamples from "@/data/new-test-mandates.json";

export const testMandates: AcquisitionBrief[] = [...savedExamples, ...newExamples].map(example => briefSchema.parse(readableStoredBrief(example)));
