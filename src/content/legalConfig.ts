/**
 * Single source of truth for legal/commercial facts referenced by the
 * Privacy Policy, Refund Policy, Pricing page, and Cancellation Policy.
 *
 * Verified fields come from src/seo/constants.ts and the current
 * implementation (see api/inquiry-notification.ts, src/lib/analytics.ts,
 * src/seo/Clarity.tsx). Unverified fields are left blank and listed in
 * LEGAL_INFORMATION_REQUIRED below rather than guessed. Do not fill a
 * blank field with an example value.
 */

import { SEO_CONSTANTS } from '../seo/constants';

export const legalConfig = {
  companyName: 'PREZENTI BUSINESS SERVICES PRIVATE LIMITED',
  brandName: SEO_CONSTANTS.SITE_NAME,
  website: SEO_CONSTANTS.BASE_URL,

  legalEmail: 'support@prezenti.com',
  privacyEmail: 'support@prezenti.com',
  supportEmail: 'support@prezenti.com',
  phone: '+91 8788726752',
  whatsapp: SEO_CONSTANTS.WHATSAPP,

  city: SEO_CONSTANTS.CITY,
  state: SEO_CONSTANTS.STATE,
  country: 'India',
  registeredAddress: '3rd Floor, 116/3/1/4, Unity Constructions, Baner Road, Baner, Pune, Maharashtra 411045, India',

  effectiveDate: '9 September 2026',
  lastUpdated: '9 September 2026',
  version: '2.0',

  businessModel: {
    customerType:
      'Corporate offices, commercial buildings, IT parks/campuses, healthcare facilities, educational institutions, and other business/institutional clients.',
    purchaseModel:
      'Inquiry -> requirement review -> custom quotation -> mutually agreed service agreement / work order -> deployment -> billing as per the agreement. Prezenti does not sell services through an online checkout on this website.',
    onlinePaymentSupported: false,
  },

  pricing: {
    model: 'custom-quote' as const,
    currency: 'INR',
    taxTreatment: '', // Whether quoted figures are tax-inclusive/exclusive, and applicable GST treatment, is not confirmed.
  },

  payment: {
    gateway: '', // No payment gateway is integrated in this codebase.
    methods: [] as string[], // Accepted payment methods for offline billing are not confirmed.
    advancePayment: '', // Whether/what advance payment is required is set per client agreement, not a fixed site-wide rule.
    invoicePolicy: '', // Invoicing cadence/format not confirmed.
  },

  refund: {
    eligibility: '', // Refund eligibility is governed by the individual signed service agreement.
    processingTime: '', // No company-wide refund timeline has been approved.
  },

  cancellation: {
    noticePeriod: '', // No company-wide notice period has been approved; defined per service agreement.
    charges: '', // No company-wide cancellation charge schedule has been approved.
  },

  jurisdiction: '', // Governing law / courts of jurisdiction (city) not confirmed.

  analyticsProviders: [
    { name: 'Google Analytics 4', purpose: 'Website usage and traffic analytics.' },
    { name: 'Microsoft Clarity', purpose: 'Session behavior analytics (e.g. click/scroll patterns, session recordings).' },
  ],

  dataProcessors: [
    { name: 'Google (Google Analytics 4)', purpose: 'Website usage analytics.' },
    { name: 'Microsoft (Clarity)', purpose: 'Website behavior analytics.' },
    { name: 'Google Workspace / Gmail SMTP', purpose: "Delivers inquiry-form notification emails to Prezenti Business Services Pvt. Ltd.'s team." },
    { name: 'Twilio (WhatsApp Business API)', purpose: "Delivers inquiry-form notification messages to Prezenti Business Services Pvt. Ltd.'s team over WhatsApp." },
    { name: 'Vercel', purpose: 'Website hosting and serverless function execution.' },
  ],
};

export type LegalConfig = typeof legalConfig;

/**
 * Business-approved facts still required to complete the legal/commercial
 * documents. Nothing in this list has been guessed or invented anywhere
 * in the four legal pages.
 */
export const LEGAL_INFORMATION_REQUIRED = [
  {
    field: 'LEGAL_ENTITY_NAME',
    why: 'Required for a legally binding Privacy Policy / Refund Policy / Cancellation Policy identifying the contracting party.',
    appearsIn: ['Privacy Policy', 'Refund Policy', 'Cancellation Policy'],
    owner: 'Management / Company Secretary',
  },
  {
    field: 'REGISTERED_OFFICE_ADDRESS',
    why: 'Required for grievance-officer disclosure and standard legal-page identity requirements.',
    appearsIn: ['Privacy Policy'],
    owner: 'Management',
  },
  {
    field: 'GSTIN',
    why: 'Needed if GST is to be itemized on quotations/invoices referenced from the Pricing page.',
    appearsIn: ['Pricing & Payment'],
    owner: 'Finance',
  },
  {
    field: 'DEDICATED_PRIVACY_GRIEVANCE_CONTACT',
    why: "Only a general inbox (weprezenti@gmail.com) exists today; a named grievance officer/contact strengthens DPDP-readiness.",
    appearsIn: ['Privacy Policy'],
    owner: 'Management',
  },
  {
    field: 'PAYMENT_METHODS_AND_GATEWAY',
    why: 'No online payment gateway is implemented; needed only if/when online payment is introduced.',
    appearsIn: ['Pricing & Payment', 'Refund Policy'],
    owner: 'Finance / Management',
  },
  {
    field: 'TAX_TREATMENT',
    why: 'Whether quoted prices are GST-inclusive or exclusive is not documented anywhere in the repository.',
    appearsIn: ['Pricing & Payment'],
    owner: 'Finance',
  },
  {
    field: 'REFUND_ELIGIBILITY_AND_TIMELINE',
    why: 'No company-wide refund rule or timeline has been approved by management.',
    appearsIn: ['Refund Policy'],
    owner: 'Finance / Management',
  },
  {
    field: 'CANCELLATION_NOTICE_PERIOD_AND_CHARGES',
    why: 'No company-wide notice period or cancellation charge schedule has been approved by management.',
    appearsIn: ['Cancellation Policy'],
    owner: 'Management',
  },
  {
    field: 'DATA_RETENTION_PERIODS',
    why: 'No retention schedule has been defined for inquiry records, analytics data, or communication logs.',
    appearsIn: ['Privacy Policy'],
    owner: 'Management / Legal counsel',
  },
  {
    field: 'GOVERNING_LAW_JURISDICTION',
    why: 'The city/courts with exclusive jurisdiction for disputes has not been confirmed.',
    appearsIn: ['Terms and Conditions'],
    owner: 'Legal counsel',
  },
] as const;
