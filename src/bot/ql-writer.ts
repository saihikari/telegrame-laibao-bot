import { qlApi } from './ql-api';
import { appendRecordLog } from './record-log';
import { addToQueue } from './queue-log';
import { getConfig } from './config-loader';

type OfferTemplateFields = {
    bianHao?: string;
    product?: string;
    thirdName?: string;
    adName?: string;
    [key: string]: any;
};

const CODE_PROFILE_PATTERN = /^(.*?)(\d+)$/;
const CODE_CANDIDATE_PATTERN = /[\u4e00-\u9fffA-Za-z0-9]+/g;

// Definition of the structure output by rule-engine
export interface ParsedRecord {
    客户: string;       // Used to map to storeId
    编号: string;       // Used to extract the suffix (e.g. "050")
    产品名称?: string;  // Sometimes parsed, but the rule says suffix is from "编号"
    链接: string;       // The new app URL
    [key: string]: any;
}

function parseCodeProfile(code: string) {
    const normalized = String(code || '').trim();
    const match = normalized.match(CODE_PROFILE_PATTERN);
    if (!match) return null;

    return {
        raw: normalized,
        prefix: match[1],
        digitLength: match[2].length
    };
}

function extractCodeCandidates(text: string): string[] {
    const matches = String(text || '').match(CODE_CANDIDATE_PATTERN) || [];
    return [...new Set(matches.filter((token) => /\d/.test(token)))];
}

export function detectOldCodeFromTemplate(baseOffer: OfferTemplateFields, newCode: string): string {
    const profile = parseCodeProfile(newCode);
    if (!profile) {
        throw new Error(`新编号格式无法识别: ${newCode}`);
    }

    const fieldOrder = ['bianHao', 'product', 'thirdName', 'adName'] as const;
    const exactMatchesByField = new Map<string, string[]>();
    const relaxedMatchesByField = new Map<string, string[]>();

    for (const field of fieldOrder) {
        const value = String(baseOffer[field] || '');
        if (!value) continue;

        const tokens = extractCodeCandidates(value);
        const exactMatchedTokens = tokens.filter((token) => {
            const candidateProfile = parseCodeProfile(token);
            return !!candidateProfile
                && candidateProfile.prefix === profile.prefix
                && candidateProfile.digitLength === profile.digitLength;
        });
        const relaxedMatchedTokens = tokens.filter((token) => {
            const candidateProfile = parseCodeProfile(token);
            return !!candidateProfile && candidateProfile.prefix === profile.prefix;
        });

        if (exactMatchedTokens.length > 0) {
            exactMatchesByField.set(field, [...new Set(exactMatchedTokens)]);
        }

        if (relaxedMatchedTokens.length > 0) {
            relaxedMatchesByField.set(field, [...new Set(relaxedMatchedTokens)]);
        }
    }

    const pickUniqueMatch = (matchesByField: Map<string, string[]>) => {
        const primaryMatches = matchesByField.get('bianHao');
        if (primaryMatches?.length === 1) {
            return primaryMatches[0];
        }

        const uniqueTokens = [...new Set(Array.from(matchesByField.values()).flat())];
        if (uniqueTokens.length === 1) {
            return uniqueTokens[0];
        }

        return uniqueTokens;
    };

    const exactMatchResult = pickUniqueMatch(exactMatchesByField);
    if (typeof exactMatchResult === 'string') {
        return exactMatchResult;
    }

    if (exactMatchResult.length > 1) {
        throw new Error(`母本中匹配到多个旧编号候选: ${exactMatchResult.join(', ')}`);
    }

    const relaxedMatchResult = pickUniqueMatch(relaxedMatchesByField);
    if (typeof relaxedMatchResult === 'string') {
        return relaxedMatchResult;
    }

    if (relaxedMatchResult.length === 0) {
        throw new Error(`母本中找不到与新编号 ${newCode} 格式一致的旧编号`);
    }

    throw new Error(`母本中匹配到多个旧编号候选: ${relaxedMatchResult.join(', ')}`);
}

export function replaceOfferCodesByTemplate(baseOffer: OfferTemplateFields, newCode: string): OfferTemplateFields {
    const normalizedNewCode = String(newCode || '').trim();
    const oldCode = detectOldCodeFromTemplate(baseOffer, normalizedNewCode);
    const updatedOffer = { ...baseOffer };

    for (const field of ['product', 'bianHao', 'thirdName', 'adName'] as const) {
        const value = updatedOffer[field];
        if (!value) continue;

        const text = String(value).trim();
        const index = text.indexOf(oldCode);
        if (index === -1) {
            updatedOffer[field] = text;
            continue;
        }

        updatedOffer[field] = text.slice(0, index) + normalizedNewCode + text.slice(index + oldCode.length);
    }

    return updatedOffer;
}

export async function processAndWriteToQL(parsedRecords: ParsedRecord[], startTime: number) {
    let successCount = 0;
    let errorMessages = [];

    for (let i = 0; i < parsedRecords.length; i++) {
        const record = parsedRecords[i];
        let customerName = record['客户'];
        try {
            if (i > 0) {
                const config = getConfig();
                const minSec = config.delayMinSeconds ?? parseInt(process.env.DELAY_MIN_SECONDS || '6', 10);
                const maxSec = config.delayMaxSeconds ?? parseInt(process.env.DELAY_MAX_SECONDS || '12', 10);
                const delayMs = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
                console.log(`[QL Writer] 等待 ${delayMs / 1000} 秒后继续录入下一条...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            // 1. Use customerName from routes.json directly to query storeId
            if (!customerName) throw new Error("缺少 '客户' 字段，无法查询 storeId");

            const stores = await qlApi.listStoreToSelect();
            const store = stores.find((s: any) => s.storeName && s.storeName.includes(customerName));
            if (!store) {
                throw new Error(`找不到商户名称包含 '${customerName}' 的 store`);
            }
            const storeId = store.storeId;

            // 2. Get base offer
            const offers = await qlApi.listOffer(storeId);
            if (!offers || offers.length === 0) {
                throw new Error(`商户 (ID: ${storeId}) 下没有找到任何历史 Offer 作为母本`);
            }
            const baseOffer = offers[0]; // Currently taking the latest one as the template

            // 3. Clone and assemble new offer
            const newOffer = JSON.parse(JSON.stringify(baseOffer));
            delete newOffer.id;
            delete newOffer.createdAt;
            delete newOffer.updatedAt;
            // newOffer.pStatus = "未开启"; // Can be uncommented if default status should be closed
            const incomingCode = record['编号'] || record['产品名称'];
            if (!incomingCode) {
                throw new Error("缺少 '编号' 字段，无法替换母本编号");
            }

            Object.assign(newOffer, replaceOfferCodesByTemplate(newOffer, incomingCode));

            // Update the link (Fallback to 'APP链接' if '链接' is missing)
            newOffer.productUrl = record['链接'] || record['APP链接'] || record['应用链接'] || record['URL'];

            // 4. Submit
            await qlApi.addOffer(newOffer);
            successCount++;

            // Log Success
            const endTime = Date.now();
            appendRecordLog({
                sheetName: "QL_API_SUCCESS",
                content: `客户: ${customerName} | 产品: ${newOffer.product} | 链接: ${newOffer.productUrl}`,
                startAt: new Date(startTime).toISOString(),
                endAt: new Date(endTime).toISOString(),
                elapsedMs: endTime - startTime,
                savedSeconds: ((endTime - startTime) / 1000) * 15
            }).catch(() => undefined);
        } catch (e: any) {
            errorMessages.push(`记录 '${record['编号'] || '未知'}' 失败: ${e.message}`);
            // write to failure queue
            addToQueue({
                customerName: customerName || record['客户'] || '未知客户',
                recordData: record,
                errorMsg: e.message
            });
            
            console.error('[QL Writer Error]', e);
        }
    }

    if (errorMessages.length > 0) {
        throw new Error("部分或全部录入失败:\n" + errorMessages.join("\n"));
    }

    return { successCount };
}
