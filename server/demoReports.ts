// The reports of case 3's repeat colonoscopy (fictional). The endoscopy unit and the
// laboratory send them during the demo (scripts/demo/steps.ts, steps 3.7 and 3.9), and the
// seed caches the reading of the two together (server/seed.ts), so the closure review
// reads them without a model key or the network.

export const REPEAT_COLONOSCOPY_REPORT =
  "Procedure: repeat colonoscopy. Preparation was adequate (Boston Bowel Preparation Scale 8). " +
  "The cecum was reached and photographed. One 8 mm sessile polyp in the sigmoid colon was " +
  "removed by cold snare and sent for histology. No other lesion seen.";

export const PATHOLOGY_REPORT =
  "Specimen: sigmoid polyp, cold snare polypectomy. Diagnosis: tubular adenoma with low-grade " +
  "dysplasia, 8 mm, completely excised. Recommendation: surveillance colonoscopy in 3 years.";
