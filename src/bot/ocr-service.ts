import Tesseract from 'tesseract.js';

export interface OCRResult {
    usdAmount?: string;
    payDay?: string;
    rawText: string;
}

export async function recognizeChargeImage(imageBuffer: Buffer): Promise<OCRResult> {
    // Run OCR (using eng + chi_sim if needed, but eng is usually enough for USDT and dates)
    const result = await Tesseract.recognize(imageBuffer, 'eng+chi_sim', {
        logger: m => console.log(m)
    });
    const text = result.data.text;
    console.log("[OCR] Raw Text:", text);

    let usdAmount: string | undefined;
    let payDay: string | undefined;

    // --- Extract Amount ---
    // Look for numbers before "USDT" or negative numbers like "-808 USDT" or "2,020 USDT"
    // Also handling spaces like "2,020  USDT"
    const amountRegex = /([-+]?[\d,]+(?:\.\d+)?)\s*USDT/i;
    const amountMatch = text.match(amountRegex);
    if (amountMatch) {
        // Clean up commas and plus signs
        let cleanNumStr = amountMatch[1].replace(/,/g, '').replace('+', '');
        // If it's negative (e.g., -808 USDT transfer out), we might still want to record the absolute value for charge, 
        // or keep it negative? Usually charge is positive absolute value.
        cleanNumStr = cleanNumStr.replace('-', ''); 
        if (!isNaN(Number(cleanNumStr))) {
            usdAmount = cleanNumStr;
        }
    }

    // --- Extract Date ---
    // Match common date formats: 2026-04-15, 2026/04/16, 2026年4月15日
    const dateRegex1 = /(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])/;
    const dateRegex2 = /(20\d{2})\s*年\s*([1-9]|1[0-2])\s*月\s*([1-9]|[12]\d|3[01])\s*日/;
    const dateRegex3 = /(0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])[-/](20\d{2})/; // MM/DD/YYYY 或 MM-DD-YYYY

    let dMatch = text.match(dateRegex1);
    if (dMatch) {
      payDay = `${dMatch[1]}-${dMatch[2]}-${dMatch[3]}`;
    } else {
      dMatch = text.match(dateRegex2);
      if (dMatch) {
        const y = dMatch[1];
        const m = dMatch[2].padStart(2, '0');
        const d = dMatch[3].padStart(2, '0');
        payDay = `${y}-${m}-${d}`;
      } else {
        dMatch = text.match(dateRegex3);
        if (dMatch) {
          // dMatch[1]是月, dMatch[2]是日, dMatch[3]是年
          payDay = `${dMatch[3]}-${dMatch[1]}-${dMatch[2]}`;
        }
      }
    }

    // If date not found in text, we'll let the user manually correct or fallback to today
    
    return { usdAmount, payDay, rawText: text };
}
