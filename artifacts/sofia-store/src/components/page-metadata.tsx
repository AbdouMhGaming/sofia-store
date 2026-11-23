import { useEffect } from "react";
import { useLocation } from "wouter";

const pages: Record<string, [string, string]> = {
  "/": ["Mode féminine à Relizane", "Découvrez l'aperçu des collections de mode féminine SOFIA STORE à Relizane. Prix et disponibilités à confirmer."],
  "/boutique": ["La collection", "Découvrez les robes brodées et les collections SOFIA STORE. Contactez la boutique pour les prix et les disponibilités."],
  "/a-propos": ["La maison", "Découvrez SOFIA STORE, boutique de mode féminine dans la région de Relizane en Algérie."],
  "/contact": ["Contact", "Contactez SOFIA STORE à Relizane pour connaître les prix, les tailles et les disponibilités."],
  "/favoris": ["Vos favoris", "Retrouvez les pièces SOFIA STORE enregistrées sur cet appareil."],
  "/admin/login": ["Connexion équipe", "Accès sécurisé à la gestion SOFIA STORE."],
  "/admin": ["Tableau de bord", "Gestion du catalogue et des stocks SOFIA STORE."],
  "/admin/produits": ["Gestion des produits", "Gestion des produits et variantes SOFIA STORE."],
  "/admin/inventaire": ["Inventaire", "Suivi des stocks et mouvements SOFIA STORE."],
  "/admin/activite": ["Historique", "Journal des actions de gestion SOFIA STORE."],
  "/admin/categories": ["Catégories", "Gestion des catégories bilingues SOFIA STORE."],
  "/admin/import-export": ["Import et export", "Transfert contrôlé du catalogue SOFIA STORE au format CSV."],
  "/admin/medias": ["Médiathèque", "Gestion des photographies produits SOFIA STORE."],
  "/admin/mouvements": ["Mouvements de stock", "Historique attribué des entrées et sorties de stock SOFIA STORE."],
  "/panier": ["Panier", "Votre sélection SOFIA STORE, enregistrée sur cet appareil."],
  "/commande": ["Commande", "Finaliser une commande SOFIA STORE : livraison ou retrait en boutique, paiement à la réception."],
  "/commande/confirmation": ["Commande reçue", "Récapitulatif de votre commande SOFIA STORE."],
  "/admin/vente-en-ligne": ["Vente en ligne", "Réglages de la commande en ligne SOFIA STORE."],
  "/admin/commandes": ["Commandes", "Commandes en ligne reçues par SOFIA STORE."],
  "/pos": ["Caisse", "Encaissement en boutique SOFIA STORE."],
  "/pos/historique": ["Tickets de caisse", "Historique des ventes en boutique SOFIA STORE."],
  "/pos/sessions": ["Tiroir-caisse", "Ouvertures et clôtures du tiroir SOFIA STORE."],
  "/pos/reglages": ["Réglages du ticket", "Coordonnées imprimées sur les tickets SOFIA STORE."],
};
export function PageMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const [label, description] = pages[location] || (location.startsWith("/pos/tickets/") ? ["Ticket de caisse", "Ticket de vente SOFIA STORE."] as [string, string] : null) || (location.startsWith("/admin/commandes/") ? ["Détail de commande", "Détail d'une commande en ligne SOFIA STORE."] as [string, string] : null) || (location.startsWith("/produit/")
      ? [decodeURIComponent(location.split("/").pop() || "").replace(/^apercu-/, "").replace(/-/g, " "), "Découvrez cette pièce SOFIA STORE. Prix, tailles et disponibilités à confirmer auprès de la boutique."]
      : ["Page introuvable", "Cette page SOFIA STORE est introuvable."]);
    const title = `${label} | SOFIA STORE`;
    document.title = title;
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) document.querySelector(selector)?.setAttribute("content", title);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) document.querySelector(selector)?.setAttribute("content", description);
  }, [location]);
  return null;
}
