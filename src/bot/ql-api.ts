import fetch from 'node-fetch';
import FormData from 'form-data';

export class QLApi {
    private currentToken: string | null = null;
    private tokenExpireTime: number = 0;
    private baseUrl = 'https://www.ql-agency.com';

    async login(): Promise<string> {
        const payload = {
            phone: process.env.QL_USERNAME || '',
            password: process.env.QL_PASSWORD || '',
            id: "",
            code: ""
        };
        
        console.log(`[QL API] Logging in with user: ${payload.phone}`);

        const response = await fetch(`${this.baseUrl}/api/user/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.code === 100 && data.info?.data?.token) {
            this.currentToken = data.info.data.token;
            this.tokenExpireTime = Date.now() + (4 * 24 * 60 * 60 * 1000);
            console.log('[QL API] Login successful, token acquired.');
            return this.currentToken!;
        }
        
        throw new Error("QL API 登录失败: " + JSON.stringify(data));
    }

    async qlFetch(path: string, options: any = {}) {
        if (!this.currentToken || Date.now() > this.tokenExpireTime) {
            await this.login();
        }

        const headers = {
            'Content-Type': 'application/json',
            'token': this.currentToken,
            ...(options.headers || {})
        };

        const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
        const data = await res.json();

        if (data.code === 401 || (data.msg && data.msg.toLowerCase().includes("token"))) {
            console.log("[QL API] Token 失效或被踢，触发强制重新登录...");
            await this.login();
            headers.token = this.currentToken;
            const retryRes = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
            return await retryRes.json();
        }

        return data;
    }

    async listStoreToSelect(): Promise<any[]> {
        const data = await this.qlFetch('/api/store/listStoreToSelect?pageNum=1&pageRow=1000&storeType=1', { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error("获取商户列表失败: " + JSON.stringify(data));
    }

    async listOffer(storeId: number, pageRow: number = 100): Promise<any[]> {
        const data = await this.qlFetch(`/api/offer/listOffer?pageNum=1&pageRow=${pageRow}&storeId=${storeId}&productType=1`, { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error(`获取 Offer 列表失败 (storeId: ${storeId}): ` + JSON.stringify(data));
    }

    async editPStatus(id: number, pStatus: string = '暂停'): Promise<boolean> {
        const data = await this.qlFetch(`/api/offer/editPStatus?id=${id}&pStatus=${encodeURIComponent(pStatus)}`, { method: 'GET' });
        if (data.code === 100) {
            return true;
        }
        throw new Error(`暂停广告失败 (Offer ID: ${id}): ` + JSON.stringify(data));
    }

    async listSumShow(managerBId: number, storeName?: string): Promise<any[]> {
        const params = new URLSearchParams({
            pageNum: '1',
            pageRow: '100', // Fetch more rows to ensure we get all data
            productType: '1',
            managerBId: managerBId.toString()
        });
        if (storeName) {
            params.append('storeName', storeName);
        }

        const data = await this.qlFetch(`/api/offer/listSumShow?${params.toString()}`, { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error(`获取消耗报告失败: ` + JSON.stringify(data));
    }

    

    async listSumShowByDateRange(paramsInput: {
        managerBId: number;
        startStr: string;
        endStr: string;
        pageNum?: number;
        pageRow?: number;
        productType?: number;
        storeName?: string;
    }): Promise<any[]> {
        const params = new URLSearchParams({
            pageNum: String(paramsInput.pageNum ?? 1),
            pageRow: String(paramsInput.pageRow ?? 200),
            startStr: paramsInput.startStr,
            endStr: paramsInput.endStr,
            productType: String(paramsInput.productType ?? 1),
            managerBId: String(paramsInput.managerBId)
        });
        if (paramsInput.storeName) {
            params.append('storeName', paramsInput.storeName);
        }

        const data = await this.qlFetch(`/api/offer/listSumShow?${params.toString()}`, { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error(`获取消耗报告失败: ` + JSON.stringify(data));
    }

    async addOffer(offerObj: any): Promise<any> {
        const payload = {
            jsonStr: JSON.stringify(offerObj)
        };

        const data = await this.qlFetch('/api/offer/addOffer', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (data.code === 100) {
            this.cachedRecentStores = null;
            return data;
        }
        throw new Error("添加 Offer 失败: " + JSON.stringify(data));
    }

    async getRate(): Promise<number> {
        const data = await this.qlFetch('/api/store/getRate', { method: 'GET' });
        if (data.code === 100 && data.info?.data) {
            return parseFloat(data.info.data) || 7.3;
        }
        console.warn("[QL API] 获取汇率失败，降级使用默认汇率 7.3");
        return 7.3;
    }

    async uploadFile(fileBuffer: Buffer, filename: string): Promise<string> {
        if (!this.currentToken || Date.now() > this.tokenExpireTime) {
            await this.login();
        }

        const formData = new FormData();
        formData.append('file', fileBuffer, { filename });

        const res = await fetch(`${this.baseUrl}/api/store/uploadFile`, {
            method: 'POST',
            headers: {
                'token': this.currentToken!,
                ...formData.getHeaders()
            },
            body: formData
        });

        const data = await res.json();
        if (data.code === 100 && data.info?.data) {
            return data.info.data; // e.g. https://...cos...
        }
        throw new Error("图片上传失败: " + JSON.stringify(data));
    }

    async saveCharge(chargeObj: any): Promise<any> {
        const body = new URLSearchParams({
            jsonStr: JSON.stringify(chargeObj)
        }).toString();

        const data = await this.qlFetch('/api/store/saveCharge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        });

        if (data.code === 100) {
            return data;
        }
        throw new Error("商户充值录入失败: " + JSON.stringify(data));
    }

    async getReportLink(storeId: number): Promise<string | null> {
        console.log(`[QL API] Fetching report link for storeId: ${storeId}`);
        try {
            const data = await this.qlFetch(`/api/store/listStore?pageNum=1&pageRow=20&storeId=${storeId}&showMoney=1`, { method: 'GET' });
            if (data.code === 100 && data.info?.data?.length > 0) {
                const storeInfo = data.info.data[0];
                // Check common URL fields for Google Sheets link
                if (storeInfo.outReportUrl) return storeInfo.outReportUrl;
                if (storeInfo.tableUrl) return storeInfo.tableUrl;
                if (storeInfo.reportUrl) return storeInfo.reportUrl;
                if (storeInfo.sheetUrl) return storeInfo.sheetUrl;
                if (storeInfo.link) return storeInfo.link;
                if (storeInfo.url) return storeInfo.url;
                
                // fallback: let's see what keys are there for debugging
                console.log(`[QL API] Store ${storeId} keys:`, Object.keys(storeInfo).join(', '));
                // Try to find any key containing 'url' or 'link'
                const fallbackKey = Object.keys(storeInfo).find(k => 
                    (k.toLowerCase().includes('url') || k.toLowerCase().includes('link')) 
                    && typeof storeInfo[k] === 'string' 
                    && storeInfo[k].startsWith('http')
                );
                if (fallbackKey) {
                    console.log(`[QL API] Found fallback URL field: ${fallbackKey}`);
                    return storeInfo[fallbackKey];
                }
            }
        } catch (e) {
            console.error(`[QL API] Error fetching report link:`, e);
        }
        
        return null;
    }

    private cachedRecentStores: { names: string[], expireAt: number } | null = null;

    async listRecentOffers(totalCount: number = 1000): Promise<any[]> {
        // 为了防止单次请求过大（如 pageRow=3000）导致 QL 接口崩溃或超时返回 HTML 502/504
        // 我们将其拆分为多个 pageRow=500 的小请求并合并
        const pageSize = 500;
        const totalPages = Math.ceil(totalCount / pageSize);
        let allOffers: any[] = [];
        
        for (let i = 1; i <= totalPages; i++) {
            const data = await this.qlFetch(`/api/offer/listOffer?pageNum=${i}&pageRow=${pageSize}&productType=1`, { method: 'GET' });
            if (data.code === 100 && data.info?.data) {
                allOffers = allOffers.concat(data.info.data);
                // 如果当前页返回的数据少于 pageSize，说明已经没数据了，提前结束
                if (data.info.data.length < pageSize) break;
            } else {
                if (i === 1) {
                    throw new Error(`获取最近 Offer 列表失败: ` + JSON.stringify(data));
                }
                break;
            }
        }
        return allOffers;
    }

    async getRecentStoreNames(limit: number = 4): Promise<string[]> {
        if (this.cachedRecentStores && Date.now() < this.cachedRecentStores.expireAt) {
            return this.cachedRecentStores.names;
        }

        const data = await this.qlFetch(`/api/offer/listOffer?pageNum=1&pageRow=30&productType=1`, { method: 'GET' });
        if (data.code === 100) {
            const records = data.info?.data || [];
            
            records.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

            const uniqueStoreNames: string[] = [];
            const seen = new Set<string>();

            for (const record of records) {
                const sName = record.storeName;
                if (sName && !seen.has(sName)) {
                    seen.add(sName);
                    uniqueStoreNames.push(sName);
                    if (uniqueStoreNames.length >= limit) break;
                }
            }

            this.cachedRecentStores = {
                names: uniqueStoreNames,
                expireAt: Date.now() + 15000
            };

            return uniqueStoreNames;
        }
        return [];
    }
    async listManagers(): Promise<any[]> {
        const data = await this.qlFetch('/api/user/listManagers?pageNum=1&pageRow=1000', { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error('获取经理列表失败: ' + JSON.stringify(data));
    }

    async listStores(managerId?: number): Promise<any[]> {
        const url = managerId 
            ? `/api/store/listStore?pageNum=1&pageRow=1000&managerId=${managerId}&showMoney=1`
            : `/api/store/listStore?pageNum=1&pageRow=1000&showMoney=1`;
        const data = await this.qlFetch(url, { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error('获取商户详情失败: ' + JSON.stringify(data));
    }
}

export const qlApi = new QLApi();
