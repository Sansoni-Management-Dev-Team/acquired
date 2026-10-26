export type ResearchTestMandate = {
  id: string;
  name: string;
  states: string[];
  revenue: string;
  ebitda: string;
  employees: string;
  focus: string;
  description: string;
};

type Sample = Omit<ResearchTestMandate, 'description'>;

// Fictional acquisition criteria for live research. Selecting a sample never
// creates work; the normal mandate generator and research-only workflow run it.
const samples: Sample[] = [
  { id: 'commercial-refrigeration', name: 'Commercial refrigeration', states: ['QLD', 'NSW'], revenue: '4–12 million', ebitda: '700,000–2 million', employees: '15–55', focus: 'Recurring inspection, maintenance and repair for supermarkets, food retailers and cold-storage operators. Exclude residential appliance retailers.' },
  { id: 'fire-protection', name: 'Fire protection maintenance', states: ['VIC'], revenue: '3.5–12 million', ebitda: '500,000–2.1 million', employees: '18–90', focus: 'Recurring fire-system inspection, testing, servicing and compliance contracts for commercial buildings. Exclude businesses that only sell equipment.' },
  { id: 'water-treatment', name: 'Water treatment services', states: ['QLD'], revenue: '5–18 million', ebitda: '800,000–3.2 million', employees: '25–100', focus: 'Industrial and commercial water-treatment equipment servicing, preventative maintenance and recurring consumables. Exclude government utilities.' },
  { id: 'industrial-electrical', name: 'Industrial electrical services', states: ['WA'], revenue: '5–20 million', ebitda: '800,000–3.5 million', employees: '25–120', focus: 'Industrial electrical maintenance, automation, control systems and ongoing service contracts. Prefer diversified customers over reliance on one mining project.' },
  { id: 'hvac-maintenance', name: 'Commercial HVAC maintenance', states: ['NSW', 'VIC'], revenue: '4–16 million', ebitda: '600,000–2.8 million', employees: '20–85', focus: 'Commercial air-conditioning and ventilation maintenance with recurring facilities-management contracts. Exclude residential installation-only businesses.' },
  { id: 'precision-engineering', name: 'Precision engineering', states: ['VIC', 'SA'], revenue: '6–22 million', ebitda: '900,000–3.8 million', employees: '30–140', focus: 'CNC machining, precision components and repeat manufacturing work for industrial, medical or defence customers. Prefer in-house production capability.' },
  { id: 'metal-fabrication', name: 'Specialist metal fabrication', states: ['QLD', 'NSW'], revenue: '5–18 million', ebitda: '700,000–3 million', employees: '25–110', focus: 'Custom stainless-steel or sheet-metal fabrication for industrial customers, with repeat orders and in-house manufacturing. Exclude scrap-metal traders.' },
  { id: 'food-packaging', name: 'Food packaging manufacturing', states: ['VIC', 'SA'], revenue: '6–22 million', ebitda: '900,000–3.8 million', employees: '30–140', focus: 'Manufacture of food-safe flexible, rigid or paper-based packaging with repeat business customers. Exclude packaging distributors without local manufacturing.' },
  { id: 'specialty-food', name: 'Specialty food production', states: ['NSW', 'VIC', 'QLD'], revenue: '8–18 million', ebitda: '1.2–3 million', employees: '30–100', focus: 'Specialty bakery products, condiments or gluten-free food production with food-safety accreditation and wholesale customers. Exclude restaurants and cafes.' },
  { id: 'medical-distribution', name: 'Medical equipment distribution', states: ['NSW', 'QLD'], revenue: '5–20 million', ebitda: '800,000–3.3 million', employees: '15–70', focus: 'B2B distribution of specialist medical equipment and consumables, with repeat orders, supplier relationships and service capability. Exclude retail pharmacies.' },
  { id: 'commercial-laundry', name: 'Commercial laundry services', states: ['VIC', 'TAS'], revenue: '4–14 million', ebitda: '600,000–2.4 million', employees: '25–100', focus: 'Contract laundry and linen hire for healthcare, hospitality and commercial customers. Prefer owned processing facilities and diversified contracts.' },
  { id: 'industrial-cleaning', name: 'Industrial cleaning', states: ['NSW', 'VIC'], revenue: '3–10 million', ebitda: '450,000–1.5 million', employees: '25–100', focus: 'Contract cleaning for factories, warehouses and food-production facilities, with recurring work and trained supervisors. Exclude domestic cleaning marketplaces.' },
  { id: 'waste-recycling', name: 'Waste collection and recycling', states: ['QLD', 'NSW'], revenue: '6–25 million', ebitda: '900,000–4 million', employees: '25–130', focus: 'Commercial waste collection, skip-bin services or specialist recycling with recurring customers, relevant licences and an operating fleet. Exclude government entities.' },
  { id: 'managed-it', name: 'Managed IT services', states: ['VIC', 'NSW'], revenue: '3–12 million', ebitda: '500,000–2.2 million', employees: '15–60', focus: 'Managed infrastructure, cloud support and cybersecurity services for small and mid-sized business customers. Prefer recurring support agreements over hardware resale.' },
  { id: 'cybersecurity', name: 'Cybersecurity consulting', states: ['NSW', 'ACT'], revenue: '2–8 million', ebitda: '400,000–1.8 million', employees: '10–40', focus: 'Security assessments, penetration testing, governance and ongoing security services. Prefer repeat business customers and a retained technical leadership team.' },
  { id: 'payroll-bookkeeping', name: 'Payroll and bookkeeping', states: ['QLD', 'VIC'], revenue: '2–7 million', ebitda: '400,000–1.4 million', employees: '12–45', focus: 'Outsourced payroll, bookkeeping and recurring financial administration for business customers. Prefer documented processes and low customer concentration.' },
  { id: 'freight-logistics', name: 'Specialist freight and logistics', states: ['VIC', 'NSW'], revenue: '8–30 million', ebitda: '1–4 million', employees: '35–160', focus: 'Specialist B2B freight, refrigerated transport or contract logistics with recurring customer routes. Prefer diversified contracts and a maintained fleet.' },
  { id: 'safety-distribution', name: 'Workplace safety supplies', states: ['WA', 'QLD'], revenue: '5–20 million', ebitda: '700,000–3 million', employees: '15–75', focus: 'B2B distribution of PPE, workwear and industrial safety consumables, with repeat account customers and reliable supplier relationships. Exclude consumer-only online stores.' },
  { id: 'landscape-maintenance', name: 'Commercial landscape maintenance', states: ['SA', 'ACT'], revenue: '3–10 million', ebitda: '450,000–1.6 million', employees: '20–80', focus: 'Recurring grounds and landscape maintenance for commercial properties, strata or facilities managers. Exclude businesses focused solely on one-off residential garden design.' },
  { id: 'lift-maintenance', name: 'Lift and access maintenance', states: ['NSW', 'VIC'], revenue: '5–16 million', ebitda: '800,000–2.7 million', employees: '20–85', focus: 'Independent lift, escalator or building-access equipment maintenance, with recurring service contracts and qualified technicians. Prefer an established management team.' },
];

export const researchTestMandates: readonly ResearchTestMandate[] = samples.map(sample => ({
  ...sample,
  description: `We are seeking to acquire an established ${sample.name.toLowerCase()} business operating in ${sample.states.join(' or ')}, Australia. Target annual revenue of AUD ${sample.revenue}, EBITDA of AUD ${sample.ebitda}, and approximately ${sample.employees} employees. ${sample.focus} We prefer a full or majority acquisition with an owner transition period.`,
}));
