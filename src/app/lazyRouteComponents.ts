import { lazy } from 'react';

export const TalkToUs = lazy(() => import('../pages/TalkToUs').then((module) => ({ default: module.TalkToUs })));
export const ServicesHubPage = lazy(() => import('../pages/ServicesHubPage').then((module) => ({ default: module.ServicesHubPage })));
export const PrivacyPolicy = lazy(() => import('../pages/PrivacyPolicy').then((module) => ({ default: module.PrivacyPolicy })));
export const TermsAndConditions = lazy(() => import('../pages/TermsAndConditions').then((module) => ({ default: module.TermsAndConditions })));
export const IndustryLandingPage = lazy(() => import('../pages/IndustryLandingPage').then((module) => ({ default: module.IndustryLandingPage })));
export const BlogHubPage = lazy(() => import('../pages/BlogHubPage').then((module) => ({ default: module.BlogHubPage })));
export const BlogPostPage = lazy(() => import('../pages/BlogPostPage').then((module) => ({ default: module.BlogPostPage })));
export const AboutUs = lazy(() => import('../pages/AboutUs').then((module) => ({ default: module.AboutUs })));
export const RefundPolicy = lazy(() => import('../pages/RefundPolicy').then((module) => ({ default: module.RefundPolicy })));
export const CancellationPolicy = lazy(() => import('../pages/CancellationPolicy').then((module) => ({ default: module.CancellationPolicy })));
export const PricingPage = lazy(() => import('../pages/PricingPage').then((module) => ({ default: module.PricingPage })));
export const PaymentDemoPage = lazy(() => import('../pages/PaymentDemoPage').then((module) => ({ default: module.PaymentDemoPage })));
export const PaymentResultPage = lazy(() => import('../pages/PaymentResultPage').then((module) => ({ default: module.PaymentResultPage })));
