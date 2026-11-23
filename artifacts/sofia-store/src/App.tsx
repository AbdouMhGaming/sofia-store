import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { I18nProvider } from '@/lib/i18n';
import { PageMetadata } from '@/components/page-metadata';
import { HomePage, ShopPage, ProductPage, AboutPage, ContactPage, FavoritesPage } from '@/pages/public';
import { AdminCategoriesPage, AdminImportExportPage } from '@/pages/admin-catalog';
import { AdminMediaPage } from '@/pages/admin-media';
import { AdminMovementsPage } from '@/pages/admin-stock';
import { AdminLoginPage, AdminDashboardPage, AdminProductsPage, AdminInventoryPage, AdminActivityPage } from '@/pages/admin';
import { PosRegisterPage } from '@/pages/pos-register';
import { PosHistoryPage } from '@/pages/pos-history';
import { PosTicketPage } from '@/pages/pos-ticket';
import { PosSessionsPage } from '@/pages/pos-sessions';
import { PosSettingsPage } from '@/pages/pos-settings';
import { CartPage } from '@/pages/cart';
import { CheckoutPage, ConfirmationPage } from '@/pages/checkout';
import { AdminCheckoutSettingsPage, AdminOrdersPage, AdminOrderDetailPage } from '@/pages/admin-orders';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/boutique" component={ShopPage} />
        <Route path="/produit/:slug" component={ProductPage} />
        <Route path="/a-propos" component={AboutPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/favoris" component={FavoritesPage} />
        <Route path="/panier" component={CartPage} />
        <Route path="/commande" component={CheckoutPage} />
        <Route path="/commande/confirmation" component={ConfirmationPage} />
        <Route path="/admin/vente-en-ligne" component={AdminCheckoutSettingsPage} />
        <Route path="/admin/commandes" component={AdminOrdersPage} />
        <Route path="/admin/commandes/:id" component={AdminOrderDetailPage} />
        <Route path="/admin/login" component={AdminLoginPage} />
        <Route path="/admin" component={AdminDashboardPage} />
        <Route path="/admin/produits" component={AdminProductsPage} />
        <Route path="/admin/inventaire" component={AdminInventoryPage} />
        <Route path="/admin/activite" component={AdminActivityPage} />
        <Route path="/admin/categories" component={AdminCategoriesPage} />
        <Route path="/admin/import-export" component={AdminImportExportPage} />
        <Route path="/admin/medias" component={AdminMediaPage} />
        <Route path="/admin/mouvements" component={AdminMovementsPage} />
        <Route path="/pos" component={PosRegisterPage} />
        <Route path="/pos/historique" component={PosHistoryPage} />
        <Route path="/pos/tickets/:id" component={PosTicketPage} />
        <Route path="/pos/sessions" component={PosSessionsPage} />
        <Route path="/pos/reglages" component={PosSettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <PageMetadata />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
