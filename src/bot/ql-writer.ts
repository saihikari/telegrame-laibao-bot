import { qlApi } from './ql-api';
import { appendRecordLog } from './record-log';
import { addToQueue } from './queue-log';
import { getConfig } from './config-loader';

// Definition of the structure output by rule-engine
export interface ParsedRecord {
    客户: string;       // Used to map to storeId
    编号: string;       // Used to extract the suffix (e.g. "050")
    产品名称?: string;  // Sometimes parsed, but the rule says suffix is from "编号"
    链接: string;       // The new app URL
    [key: string]: any;
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

            // Extract the suffix digits from 编号
            const suffixMatch = record['编号']?.match(/\d+$/);
            if (!suffixMatch) {
                throw new Error(`'编号' (${record['编号']}) 结尾没有找到数字序列`);
            }
            const suffix = suffixMatch[0];

            // Replace suffixes in specific fields
            if (newOffer.product) newOffer.product = newOffer.product.replace(/\d+$/, suffix);
            if (newOffer.bianHao) newOffer.bianHao = newOffer.bianHao.replace(/\d+$/, suffix);
            if (newOffer.thirdName) newOffer.thirdName = newOffer.thirdName.replace(/\d+$/, suffix);
            if (newOffer.adName) newOffer.adName = newOffer.adName.replace(/\d+$/, suffix);

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
