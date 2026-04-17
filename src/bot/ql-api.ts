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

    async listOffer(storeId: number): Promise<any[]> {
        const data = await this.qlFetch(`/api/offer/listOffer?pageNum=1&pageRow=10&storeId=${storeId}&productType=1`, { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error(`获取 Offer 列表失败 (storeId: ${storeId}): ` + JSON.stringify(data));
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
        // TODO: 需要明确真实的 QL API URL 和字段名
        // 目前暂时写一个模拟返回，待确认接口后修改
        console.log(`[QL API] Fetching report link for storeId: ${storeId}`);
        // 假设接口是 GET /api/store/getReportLink?storeId=xxx
        // const data = await this.qlFetch(`/api/store/getReportLink?storeId=${storeId}`, { method: 'GET' });
        // if (data.code === 100 && data.info?.data) {
        //     return data.info.data;
        // }
        // return null;
        
        // --- 临时 fallback：如果有已知的 Google Sheet 链接，就直接用 ---
        return null;
    }

    private cachedRecentStores: { names: string[], expireAt: number } | null = null;

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
}

export const qlApi = new QLApi();
