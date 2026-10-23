import { randomUuid } from "@/lib/random-uuid";
import type { CampaignDefinition } from "./campaign";

export const DEFAULT_CAMPAIGN_NAME = "7-step introduction sequence";

export function defaultCampaignDefinition(): CampaignDefinition {
  const emails = [
    {
      "title": "Introduction",
      "subject": "A confidential conversation about {{company_name}}",
      "body": "Hi {{first_name}},\n\nI’m exploring acquisitions in specialist industrial services and came across {{company_name}}. Would you be open to a short, confidential conversation to see whether there may be a fit?\n\nBest regards"
    },
    {
      "title": "Why I reached out",
      "subject": "Following up on {{company_name}}",
      "body": "Hi {{first_name}},\n\nI wanted to follow up because {{company_name}} appears to have capabilities in an area I’m particularly interested in. I would value a chance to learn about your priorities and whether a conversation makes sense.\n\nBest regards"
    },
    {
      "title": "Continuity",
      "subject": "A thought on continuity",
      "body": "Hi {{first_name}},\n\nIf succession or the next phase of the business is ever on your mind, I’d welcome a confidential discussion. My aim would be to understand what matters most to you before discussing any structure.\n\nBest regards"
    },
    {
      "title": "Capability fit",
      "subject": "Potential fit with {{company_name}}",
      "body": "Hi {{first_name}},\n\nI’m interested in businesses with specialist capability and experienced teams. If you are open to an introductory call, I’d be glad to explain what I’m looking for and hear your perspective.\n\nBest regards"
    },
    {
      "title": "Timing check",
      "subject": "Is the timing right?",
      "body": "Hi {{first_name}},\n\nI realise a transaction may not be on your agenda. If the timing is wrong, no problem. If a quiet conversation would be useful, I can make time next week.\n\nBest regards"
    },
    {
      "title": "Direct invitation",
      "subject": "A brief call?",
      "body": "Hi {{first_name}},\n\nWould a 15-minute confidential call be worthwhile? There is no expectation beyond getting to know each other and seeing whether our interests align.\n\nBest regards"
    },
    {
      "title": "Close the loop",
      "subject": "Closing the loop",
      "body": "Hi {{first_name}},\n\nI’ll leave this here after today. If a conversation about {{company_name}} becomes relevant later, you’re welcome to get in touch. Wishing you and the team well.\n\nBest regards"
    }
  ];
  const steps: CampaignDefinition["steps"] = [];
  emails.forEach((email, index) => {
    if (index > 0) steps.push({ id: randomUuid(), kind: "wait", title: "Wait three days", days: 3 });
    steps.push({ id: randomUuid(), kind: "email", ...email });
  });
  return { schemaVersion: 1, steps };
}
