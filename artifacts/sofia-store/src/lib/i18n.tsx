import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "fr" | "ar";

const dict = {
  fr: {
    home: "Accueil", shop: "Boutique", about: "La maison", contact: "Contact", favorites: "Favoris",
    switchLang: "العربية",
    heroEyebrow: "Relizane · Algérie",
    heroTitle: "La mode féminine, choisie avec soin.",
    heroText: "SOFIA STORE réunit des robes et tenues sélectionnées pour leurs broderies, leurs étoffes et leur tombé. Découvrez l'aperçu de nos collections, puis contactez-nous pour les tailles et les disponibilités.",
    discover: "Découvrir la collection", callUs: "Appeler la boutique",
    featured: "Pièces en vitrine", featuredText: "Une sélection de la boutique, photographiée telle qu'elle est.",
    viewAll: "Voir toute la boutique",
    toConfirm: "Prix et disponibilités à confirmer",
    previewNote: "Aperçu de collection",
    phaseTitle: "Une boutique physique, d'abord.",
    phaseText: "Pour le moment, la vente se fait en boutique et par téléphone. Aucune commande ni paiement en ligne n'est proposé sur ce site : nous préférons vous conseiller de vive voix.",
    p1t: "Voir", p1: "Parcourez les pièces de la collection en ligne.",
    p2t: "Demander", p2: "Appelez-nous pour les tailles, couleurs et prix.",
    p3t: "Essayer", p3: "Passez à la boutique à Relizane pour essayer.",
    categories: "Catégories", all: "Tout",
    search: "Rechercher une pièce", results: "pièces",
    noResults: "Aucune pièce ne correspond à cette recherche.",
    resetFilters: "Réinitialiser",
    loadError: "Impossible de charger les données.", retry: "Réessayer",
    back: "Retour à la boutique",
    variants: "Déclinaisons", size: "Taille", color: "Couleur",
    askAbout: "Demander cette pièce par téléphone",
    addFav: "Ajouter aux favoris", removeFav: "Retirer des favoris",
    notFound: "Cette pièce est introuvable.",
    favEmpty: "Vous n'avez pas encore de favoris.",
    favText: "Vos favoris sont gardés uniquement sur cet appareil.",
    aboutTitle: "SOFIA STORE, à Relizane.",
    aboutText1: "SOFIA STORE est une boutique de mode féminine à Relizane. Nous choisissons des robes et des tenues qui allient élégance, confort et détails travaillés — broderies, velours, satin froissé.",
    aboutText2: "Ce site est la vitrine de la boutique. Il montre un aperçu des pièces ; les prix, tailles et disponibilités se confirment directement avec nous.",
    values: "Ce qui nous guide", v1t: "Le détail", v1: "Broderies, finitions et étoffes regardées de près.",
    v2t: "Le conseil", v2: "Une réponse humaine, par téléphone ou en boutique.",
    v3t: "L'honnêteté", v3: "Pas de prix inventés : nous confirmons chaque information.",
    contactTitle: "Parlons de votre prochaine tenue.",
    contactText: "Appelez la boutique pour connaître les tailles, coloris et prix, ou suivez-nous sur les réseaux.",
    phone: "Téléphone", location: "Adresse", socials: "Réseaux sociaux",
    footer: "Mode féminine élégante à Relizane.", staff: "Espace équipe",
  },
  ar: {
    home: "الرئيسية", shop: "المتجر", about: "عن المتجر", contact: "اتصل بنا", favorites: "المفضلة",
    switchLang: "Français",
    heroEyebrow: "غليزان · الجزائر",
    heroTitle: "أزياء نسائية مختارة بعناية.",
    heroText: "يجمع SOFIA STORE فساتين وأطقماً مختارة لتطريزها وأقمشتها وانسيابها. اكتشفي لمحة عن مجموعاتنا، ثم اتصلي بنا لمعرفة المقاسات والتوفر.",
    discover: "اكتشفي المجموعة", callUs: "اتصلي بالمتجر",
    featured: "قطع مختارة", featuredText: "مختارات من المتجر، مصورة كما هي.",
    viewAll: "عرض كل المتجر",
    toConfirm: "السعر والتوفر يُؤكَّدان لاحقاً",
    previewNote: "معاينة المجموعة",
    phaseTitle: "متجر حقيقي، أولاً.",
    phaseText: "حالياً يتم البيع في المتجر وعبر الهاتف. لا يوجد طلب أو دفع عبر الإنترنت في هذا الموقع، نفضل أن ننصحك مباشرة.",
    p1t: "شاهدي", p1: "تصفحي قطع المجموعة عبر الإنترنت.",
    p2t: "اسألي", p2: "اتصلي بنا للمقاسات والألوان والأسعار.",
    p3t: "جربي", p3: "زوري المتجر في غليزان للتجربة.",
    categories: "الفئات", all: "الكل",
    search: "ابحثي عن قطعة", results: "قطعة",
    noResults: "لا توجد قطعة مطابقة لهذا البحث.",
    resetFilters: "إعادة الضبط",
    loadError: "تعذر تحميل البيانات.", retry: "إعادة المحاولة",
    back: "العودة إلى المتجر",
    variants: "الخيارات", size: "المقاس", color: "اللون",
    askAbout: "اسألي عن هذه القطعة بالهاتف",
    addFav: "أضيفي إلى المفضلة", removeFav: "إزالة من المفضلة",
    notFound: "هذه القطعة غير موجودة.",
    favEmpty: "لا توجد قطع مفضلة بعد.",
    favText: "تُحفظ المفضلة على هذا الجهاز فقط.",
    aboutTitle: "SOFIA STORE في غليزان.",
    aboutText1: "SOFIA STORE متجر أزياء نسائية في غليزان. نختار فساتين وأطقماً تجمع بين الأناقة والراحة والتفاصيل المتقنة: تطريز، مخمل، وساتان.",
    aboutText2: "هذا الموقع واجهة المتجر. يعرض لمحة عن القطع، أما الأسعار والمقاسات والتوفر فتُؤكَّد معنا مباشرة.",
    values: "ما يوجهنا", v1t: "التفاصيل", v1: "تطريز وتشطيب وأقمشة نتفحصها عن قرب.",
    v2t: "النصيحة", v2: "رد إنساني، بالهاتف أو في المتجر.",
    v3t: "الصدق", v3: "لا أسعار مختلقة: نؤكد كل معلومة.",
    contactTitle: "لنتحدث عن إطلالتك القادمة.",
    contactText: "اتصلي بالمتجر لمعرفة المقاسات والألوان والأسعار، أو تابعينا على مواقع التواصل.",
    phone: "الهاتف", location: "العنوان", socials: "مواقع التواصل",
    footer: "أزياء نسائية أنيقة في غليزان.", staff: "فضاء الفريق",
  },
} as const;

export type TKey = keyof typeof dict.fr;

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string; pick: (fr: string, ar: string) => string };
const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("sofia-lang") === "ar" ? "ar" : "fr"));
  useEffect(() => {
    localStorage.setItem("sofia-lang", lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const t = (k: TKey) => dict[lang][k];
  const pick = (fr: string, ar: string) => (lang === "ar" && ar?.trim() ? ar : fr);
  return <I18nCtx.Provider value={{ lang, setLang, t, pick }}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("I18nProvider missing");
  return c;
}
