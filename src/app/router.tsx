import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import { PublicLayout } from '../components/layout/PublicLayout';
import { RouteError } from '../components/errors/RouteError';
import { HomePage } from '../features/website/HomePage';
import { RouteFallback } from '../components/layout/RouteFallback';
import { SectionRedirect } from '../components/layout/SectionRedirect';
import { DynamicRouteResolver } from '../pages/DynamicRouteResolver';
import { NotFoundPage } from '../pages/NotFoundPage';
import './routes/index'; // Initialize global route registry
// lazyRouteComponents.ts already exports React.lazy()-wrapped components.
// Consume them directly here — wrapping them in a second lazy() call caused
// React error #306 ("Lazy element type must resolve to a class or function.
// Did you wrap a component in React.lazy() more than once?").
import { ServicesHubPage, PrivacyPolicy, TermsAndConditions, AboutUs, TalkToUs, RefundPolicy, CancellationPolicy, PricingPage, PaymentDemoPage, PaymentResultPage } from './lazyRouteComponents';

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/platform', element: <SectionRedirect sectionId="services" /> },
      { path: '/services', element: withSuspense(<ServicesHubPage />) },
      { path: '/privacy-policy', element: withSuspense(<PrivacyPolicy />) },
      { path: '/terms-and-conditions', element: withSuspense(<TermsAndConditions />) },
      { path: '/refund-policy', element: withSuspense(<RefundPolicy />) },
      { path: '/cancellation-policy', element: withSuspense(<CancellationPolicy />) },
      { path: '/industries', element: <SectionRedirect sectionId="services" /> },
      { path: '/about', element: withSuspense(<AboutUs />) },
      { path: '/pricing', element: withSuspense(<PricingPage />) },
      { path: '/talk-to-us', element: withSuspense(<TalkToUs />) },
      { path: '/payment-demo', element: withSuspense(<PaymentDemoPage />) },
      { path: '/payment/result', element: withSuspense(<PaymentResultPage />) },
      { path: '/live-support', element: <Navigate to="/talk-to-us" replace /> },
      { path: '/receptionist-services', element: <Navigate to="/receptionist-staffing-services" replace /> },
      { path: '/compliance', element: <SectionRedirect sectionId="services" /> },
      { path: '/case-studies', element: <SectionRedirect sectionId="home" /> },
      { path: '/faq', element: <SectionRedirect sectionId="contact" /> },
      { path: '/faqs', element: <SectionRedirect sectionId="contact" /> },
      { path: '/contact', element: <SectionRedirect sectionId="contact" /> },
      { path: '/blog', element: <DynamicRouteResolver /> },
      { path: '/blog/:slug', element: <DynamicRouteResolver /> },
      { path: '/industries/:slug', element: <DynamicRouteResolver /> },
      { path: '/locations/:slug', element: <DynamicRouteResolver /> },
      { path: '/:slug', element: <DynamicRouteResolver /> },
    ],
  },
  { path: '/app', element: <Navigate to="/" replace />, errorElement: <RouteError /> },
  { path: '/login', element: <Navigate to="/" replace />, errorElement: <RouteError /> },
  { path: '*', element: <NotFoundPage /> },
]);
