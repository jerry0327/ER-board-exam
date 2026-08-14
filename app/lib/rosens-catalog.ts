export type RosensReadingDepth = "quick" | "standard" | "full";

export type RosensChapter = {
  id: string;
  displayId: string;
  title: string;
  ordinal: number;
  volume: 1 | 2;
  part: string;
  sectionId: string;
  sectionLabel: string;
  sectionTitle: string;
  kind: "core" | "supplement" | "echapter";
};

type RawChapter = readonly [number | string, string];

type RosensSectionSpec = {
  id: string;
  volume: 1 | 2;
  part: string;
  sectionLabel: string;
  title: string;
  chapters: readonly RawChapter[];
};

export const rosensBibliography = {
  title: "Rosen’s Emergency Medicine: Concepts and Clinical Practice",
  shortTitle: "Rosen’s Emergency Medicine",
  edition: "10th Edition",
  bibliographicYear: 2023,
  publicationDate: "2022-06-27",
  volumes: 2,
  pageCount: 2768,
  isbn: "978-0-323-75789-8",
  publisher: "Elsevier",
  catalogSource: "https://evolve.elsevier.com/cs/product/9780323757898?role=faculty",
} as const;

const rosensSectionSpecs: readonly RosensSectionSpec[] = [
  {
    id: "p1-s1", volume: 1, part: "PART I · FUNDAMENTAL CLINICAL CONCEPTS", sectionLabel: "SECTION ONE", title: "Resuscitation and Analgesia",
    chapters: [
      [1, "Airway"],
      [2, "Mechanical Ventilation and Noninvasive Ventilatory Support"],
      [3, "Shock"],
      [4, "Brain Resuscitation"],
      [5, "Adult Resuscitation"],
      [6, "Pain Management"],
      [7, "Procedural Sedation and Analgesia"],
    ],
  },
  {
    id: "p1-s2", volume: 1, part: "PART I · FUNDAMENTAL CLINICAL CONCEPTS", sectionLabel: "SECTION TWO", title: "Signs, Symptoms, and Presentations",
    chapters: [
      [8, "Fever in the Adult Patient"], [9, "Weakness"], [10, "Cyanosis"], [11, "Syncope"],
      [12, "Depressed Consciousness and Coma"], [13, "Confusion"], [14, "Seizures"], [15, "Dizziness and Vertigo"],
      [16, "Headache"], [17, "Diplopia"], [18, "Red and Painful Eye"], [19, "Sore Throat"],
      [20, "Hemoptysis"], [21, "Dyspnea"], [22, "Chest Pain"], [23, "Abdominal Pain"],
      [24, "Jaundice"], [25, "Nausea and Vomiting"], [26, "Gastrointestinal Bleeding"], [27, "Diarrhea"],
      [28, "Constipation"], [29, "Acute Pelvic Pain"], [30, "Vaginal Bleeding"], [31, "Back Pain"],
    ],
  },
  {
    id: "p2-s1", volume: 1, part: "PART II · TRAUMA", sectionLabel: "SECTION ONE", title: "General Concepts and System Injuries",
    chapters: [
      [32, "Multiple Trauma"], [33, "Head Trauma"], [34, "Facial Trauma"], [35, "Spinal Trauma"], [36, "Neck Trauma"],
      [37, "Thoracic Trauma"], [38, "Abdominal Trauma"], [39, "Genitourinary Trauma"], [40, "Peripheral Vascular Trauma"],
    ],
  },
  {
    id: "p2-s2", volume: 1, part: "PART II · TRAUMA", sectionLabel: "SECTION TWO", title: "Orthopedic Injuries",
    chapters: [
      [41, "General Principles of Orthopedic Injuries"], [42, "Hand Injuries"], [43, "Wrist and Forearm Injuries"],
      [44, "Humerus and Elbow Injuries"], [45, "Shoulder Injuries"], [46, "Pelvic Injuries"], [47, "Femur and Hip Injuries"],
      [48, "Knee and Lower Leg Injuries"], [49, "Ankle and Foot Injuries"],
    ],
  },
  {
    id: "p2-s3", volume: 1, part: "PART II · TRAUMA", sectionLabel: "SECTION THREE", title: "Soft Tissue Injuries",
    chapters: [[50, "Wound Management Principles"], [51, "Foreign Bodies"], [52, "Mammalian Bites"], [53, "Venomous Animal Injuries"], [54, "Thermal Injuries"], [55, "Chemical Injuries"]],
  },
  {
    id: "p3-s1", volume: 1, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION ONE", title: "Head and Neck",
    chapters: [[56, "Oral Medicine"], [57, "Ophthalmology"], [58, "Otolaryngology"]],
  },
  {
    id: "p3-s2", volume: 1, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION TWO", title: "Pulmonary System",
    chapters: [[59, "Asthma"], [60, "Chronic Obstructive Pulmonary Disease"], [61, "Upper Respiratory Tract Infections"], [62, "Pneumonia"], [63, "Pleural Disease"]],
  },
  {
    id: "p3-s3", volume: 1, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION THREE", title: "Cardiac System",
    chapters: [[64, "Acute Coronary Syndromes"], [65, "Dysrhythmias"], [66, "Implantable Cardiac Devices"], [67, "Heart Failure"], [68, "Pericardial and Myocardial Disease"], [69, "Infective Endocarditis and Valvular Heart Disease"]],
  },
  {
    id: "p3-s4", volume: 1, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION FOUR", title: "Vascular System",
    chapters: [[70, "Hypertension"], [71, "Aortic Dissection"], [72, "Abdominal Aortic Aneurysm"], [73, "Peripheral Arteriovascular Disease"], [74, "Pulmonary Embolism and Deep Vein Thrombosis"]],
  },
  {
    id: "p3-s5", volume: 1, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION FIVE", title: "Gastrointestinal System",
    chapters: [[75, "Esophagus, Stomach, and Duodenum"], [76, "Liver and Biliary Tract Disorders"], [77, "Pancreas"], [78, "Small Intestine"], [79, "Acute Appendicitis"], [80, "Gastroenteritis"], [81, "Large Intestine"], [82, "Anorectum"]],
  },
  {
    id: "p3-s6", volume: 2, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION SIX", title: "Genitourinary and Gynecologic Systems",
    chapters: [[83, "Renal Failure"], [84, "Sexually Transmitted Infections"], [85, "Urologic Disorders"], [86, "Gynecologic Disorders"]],
  },
  {
    id: "p3-s7", volume: 2, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION SEVEN", title: "Neurology",
    chapters: [[87, "Stroke"], [88, "Seizure"], [89, "Headache Disorders"], [90, "Delirium and Dementia"], [91, "Brain and Cranial Nerve Disorders"], [92, "Spinal Cord Disorders"], [93, "Peripheral Nerve Disorders"], [94, "Neuromuscular Disorders"], [95, "Central Nervous System Infections"]],
  },
  {
    id: "p3-s8", volume: 2, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION EIGHT", title: "Behavioral Disorders",
    chapters: [[96, "Thought Disorders"], [97, "Mood Disorders"], [98, "Anxiety Disorders"], [99, "Somatic Symptoms and Related Disorders"], [100, "Factitious Disorders and Malingering"], [101, "Suicidal Behavior"]],
  },
  {
    id: "p3-s9", volume: 2, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION NINE", title: "Immunologic and Inflammatory",
    chapters: [[102, "Arthritis"], [103, "Tendinopathy and Bursitis"], [104, "Musculoskeletal Back Pain"], [105, "Systemic Lupus Erythematosus and the Vasculitides"], [106, "Allergy, Anaphylaxis, and Angioedema"], [107, "Dermatologic Presentations"]],
  },
  {
    id: "p3-s10", volume: 2, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION TEN", title: "Hematology and Oncology",
    chapters: [[108, "Blood and Blood Components"], [109, "Anemia and Polycythemia"], [110, "White Blood Cell Disorders"], [111, "Disorders of Hemostasis"], [112, "Oncologic Emergencies"]],
  },
  {
    id: "p3-s11", volume: 2, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION ELEVEN", title: "Metabolism and Endocrinology",
    chapters: [[113, "Acid-Base Disorders"], [114, "Electrolyte Disorders"], [115, "Diabetes Mellitus and Disorders of Glucose Homeostasis"], [116, "Rhabdomyolysis"], [117, "Thyroid and Adrenal Disorders"]],
  },
  {
    id: "p3-s12", volume: 2, part: "PART III · EMERGENCY MEDICINE BY SYSTEM", sectionLabel: "SECTION TWELVE", title: "Infectious Diseases",
    chapters: [[118, "Bacteria"], [119, "Viruses"], [120, "Coronaviruses"], [121, "HIV"], [122, "Parasites"], [123, "Tickborne Illnesses"], [124, "Tuberculosis"], [125, "Bone and Joint Infections"], [126, "Skin and Soft Tissue Infections"], [127, "Sepsis Syndrome"]],
  },
  {
    id: "p4-s1", volume: 2, part: "PART IV · ENVIRONMENT AND TOXICOLOGY", sectionLabel: "SECTION ONE", title: "Environment",
    chapters: [[128, "Hypothermia, Frostbite, and Non-freezing Cold Injuries"], [129, "Heat Illness"], [130, "Electrical and Lightning Injuries"], [131, "Scuba Diving and Dysbarism"], [132, "High-Altitude Medicine"], [133, "Drowning"], [134, "Radiation Injuries"]],
  },
  {
    id: "p4-s2", volume: 2, part: "PART IV · ENVIRONMENT AND TOXICOLOGY", sectionLabel: "SECTION TWO", title: "Toxicology",
    chapters: [[135, "Care of the Poisoned Patient"], [136, "Toxic Alcohols"], [137, "Alcohol-Related Disease"], [138, "Acetaminophen"], [139, "Aspirin and Nonsteroidal Agents"], [140, "Anticholinergics"], [141, "Antidepressants"], [142, "Cardiovascular Drugs"], [143, "Caustics"], [144, "Cocaine and Other Sympathomimetics"], [145, "THC and Hallucinogens"], [146, "Iron and Heavy Metals"], [147, "Hydrocarbons"], [148, "Inhaled Toxins"], [149, "Lithium"], [150, "Antipsychotics"], [151, "Opioids"], [152, "Pesticides"], [153, "Plants, Herbal Medications, and Mushrooms"], [154, "Sedative-Hypnotics"]],
  },
  {
    id: "p5-s1", volume: 2, part: "PART V · SPECIAL POPULATIONS", sectionLabel: "SECTION ONE", title: "The Pediatric Patient",
    chapters: [[155, "Care of the Pediatric Patient"], [156, "Pediatric Airway Management"], [157, "Pediatric Sedation and Analgesia"], [158, "Pediatric Resuscitation"], [159, "Neonatal Resuscitation"], [160, "Pediatric Trauma"], [161, "Pediatric Fever"], [162, "Pediatric Upper Airway Obstruction and Infections"], [163, "Pediatric Lower Airway Obstruction"], [164, "Pediatric Lung Disease"], [165, "Pediatric Cardiac Disorders"], [166, "Pediatric Gastrointestinal Disorders"], [167, "Pediatric Infectious Diarrheal Disease and Dehydration"], [168, "Pediatric Genitourinary and Renal Tract Disorders"], [169, "Pediatric Neurologic Disorders"], [170, "Pediatric Musculoskeletal Disorders"], [171, "Pediatric Drug Therapy"], [172, "Child Abuse"]],
  },
  {
    id: "p5-s2", volume: 2, part: "PART V · SPECIAL POPULATIONS", sectionLabel: "SECTION TWO", title: "The Pregnant Patient",
    chapters: [[173, "Complications of Pregnancy"], [174, "Medical Emergencies During Pregnancy"], [175, "Drug Therapy in Pregnancy"], [176, "Labor and Delivery"], [177, "Trauma in Pregnancy"]],
  },
  {
    id: "p5-s3", volume: 2, part: "PART V · SPECIAL POPULATIONS", sectionLabel: "SECTION THREE", title: "The Geriatric Patient",
    chapters: [[178, "Care of the Geriatric Patient"], [179, "Geriatric Trauma"], [180, "Geriatric Drug Therapy"], [181, "Geriatric Abuse and Neglect"]],
  },
  {
    id: "p5-s4", volume: 2, part: "PART V · SPECIAL POPULATIONS", sectionLabel: "SECTION FOUR", title: "Special Clinical Circumstances",
    chapters: [[182, "The Immunocompromised Patient"], [183, "The Solid Organ Transplant Patient"], [184, "The Morbidly Obese Patient"], [185, "The Combative and Difficult Patient"]],
  },
  {
    id: "p5-s5", volume: 2, part: "PART V · SPECIAL POPULATIONS", sectionLabel: "SECTION FIVE", title: "Underserved Populations",
    chapters: [[186, "Multiculturalism, Diversity, and Care Delivery"], [187, "Human Trafficking"], [188, "Sexual Minority Populations (LGBTQ)"], [189, "Social Determinants"], [190, "Community Violence"], [191, "Sexual Assault"], [192, "Intimate Partner Violence and Abuse"]],
  },
  {
    id: "p5-s6", volume: 2, part: "ONLINE-ONLY eCHAPTERS", sectionLabel: "SECTION SIX", title: "Public Health and Humanitarian Emergencies",
    chapters: [["e01", "Global Emergency Medicine"], ["e02", "Humanitarian Aid in Disaster and Conflict"]],
  },
  {
    id: "p5-s7", volume: 2, part: "ONLINE-ONLY eCHAPTERS", sectionLabel: "SECTION SEVEN", title: "The Practice of Emergency Medicine",
    chapters: [["e03", "Emergency Ultrasound"], ["e04", "The Geriatric Emergency Department"], ["e05", "End of Life"], ["e06", "Bioethics"], ["e07", "Emergency Medical Treatment and Labor Act and Medicolegal Issues"], ["e08", "Quality Improvement and Patient Safety"], ["e09", "Patient Experience in the Emergency Department"], ["e10", "Wellness, Stress, and the Impaired Physician"], ["e11", "Forensic Emergency Medicine"]],
  },
  {
    id: "p5-s8", volume: 2, part: "ONLINE-ONLY eCHAPTERS", sectionLabel: "SECTION EIGHT", title: "Emergency Medical Services and Disaster Preparedness",
    chapters: [["e12", "Emergency Medical Services: Overview and Ground Transport"], ["e13", "Air Medical Transport"], ["e14", "Disaster Preparedness"], ["e15", "Weapons of Mass Destruction"], ["e16", "Tactical Emergency Medical Support and Urban Search and Rescue"]],
  },
] as const;

function chapterId(value: number | string) {
  if (typeof value === "number") return String(value).padStart(3, "0");
  return value.toLowerCase();
}

function chapterDisplayId(value: number | string) {
  if (typeof value === "number") return String(value).padStart(3, "0");
  return `e${Number(value.slice(1))}`;
}

export const rosensSections = rosensSectionSpecs.map(({ chapters, ...section }) => ({
  ...section,
  chapterIds: chapters.map(([id]) => chapterId(id)),
}));

export const rosensChapters: RosensChapter[] = rosensSectionSpecs.flatMap((section) => section.chapters.map(([id, title]) => ({
  id: chapterId(id),
  displayId: chapterDisplayId(id),
  title,
  ordinal: 0,
  volume: section.volume,
  part: section.part,
  sectionId: section.id,
  sectionLabel: section.sectionLabel,
  sectionTitle: section.title,
  kind: (typeof id === "string" && id.toLowerCase().startsWith("e") ? "echapter" : "core") as RosensChapter["kind"],
}))).map((chapter, index) => ({ ...chapter, ordinal: index + 1 }));

export const rosensCatalogStats = {
  totalEntries: rosensChapters.length,
  coreChapters: rosensChapters.filter((chapter) => chapter.kind === "core").length,
  supplementalChapters: rosensChapters.filter((chapter) => chapter.kind === "supplement").length,
  onlineChapters: rosensChapters.filter((chapter) => chapter.kind === "echapter").length,
  importedChapters: 208,
  contentPack: "detailed",
  readingDepths: ["quick", "standard", "full"] as const,
} as const;

// Stable import contract for the future Rosen's upload. The reader already
// routes every catalog ID through this convention, including all eChapters.
export const rosensImportContract = {
  textbookId: "rosens",
  packId: "detailed",
  basePath: "/guides/rosens/detailed",
  modes: {
    quick: "quick.md",
    standard: "standard.md",
    full: "full.md",
  },
  chapterDirectory: "{chapterId}",
} as const;
