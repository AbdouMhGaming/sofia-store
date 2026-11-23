import type { DeliveryZone } from "@workspace/api-zod";

/** The owner's requested 58-wilaya service table. No tariff or ETA is invented. */
const names = [
  ["Adrar", "أدرار"], ["Chlef", "الشلف"], ["Laghouat", "الأغواط"], ["Oum El Bouaghi", "أم البواقي"],
  ["Batna", "باتنة"], ["Béjaïa", "بجاية"], ["Biskra", "بسكرة"], ["Béchar", "بشار"],
  ["Blida", "البليدة"], ["Bouira", "البويرة"], ["Tamanrasset", "تمنراست"], ["Tébessa", "تبسة"],
  ["Tlemcen", "تلمسان"], ["Tiaret", "تيارت"], ["Tizi Ouzou", "تيزي وزو"], ["Alger", "الجزائر"],
  ["Djelfa", "الجلفة"], ["Jijel", "جيجل"], ["Sétif", "سطيف"], ["Saïda", "سعيدة"],
  ["Skikda", "سكيكدة"], ["Sidi Bel Abbès", "سيدي بلعباس"], ["Annaba", "عنابة"], ["Guelma", "قالمة"],
  ["Constantine", "قسنطينة"], ["Médéa", "المدية"], ["Mostaganem", "مستغانم"], ["M'Sila", "المسيلة"],
  ["Mascara", "معسكر"], ["Ouargla", "ورقلة"], ["Oran", "وهران"], ["El Bayadh", "البيض"],
  ["Illizi", "إليزي"], ["Bordj Bou Arréridj", "برج بوعريريج"], ["Boumerdès", "بومرداس"], ["El Tarf", "الطارف"],
  ["Tindouf", "تندوف"], ["Tissemsilt", "تيسمسيلت"], ["El Oued", "الوادي"], ["Khenchela", "خنشلة"],
  ["Souk Ahras", "سوق أهراس"], ["Tipaza", "تيبازة"], ["Mila", "ميلة"], ["Aïn Defla", "عين الدفلى"],
  ["Naâma", "النعامة"], ["Aïn Témouchent", "عين تموشنت"], ["Ghardaïa", "غرداية"], ["Relizane", "غليزان"],
  ["Timimoun", "تيميمون"], ["Bordj Badji Mokhtar", "برج باجي مختار"], ["Ouled Djellal", "أولاد جلال"], ["Béni Abbès", "بني عباس"],
  ["In Salah", "عين صالح"], ["In Guezzam", "عين قزام"], ["Touggourt", "تقرت"], ["Djanet", "جانت"],
  ["El M'Ghair", "المغير"], ["El Meniaa", "المنيعة"],
];
export function wilayaDefaults(): DeliveryZone[] {
  return names.map(([nameFr, nameAr], index) => ({
    code: String(index + 1).padStart(2, "0"), nameFr: nameFr!, nameAr: nameAr!, enabled: false,
    homeFeeMinor: null, deskFeeMinor: null, homeMinDays: null, homeMaxDays: null, deskMinDays: null, deskMaxDays: null,
  }));
}
