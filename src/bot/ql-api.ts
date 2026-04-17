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
            // Token usually expires in 5 days, set refresh threshold to 4 days
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

        // Fallback for unexpected token expiration
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
        // pageRow=1000 to get all possible stores
        const data = await this.qlFetch('/api/store/listStoreToSelect?pageNum=1&pageRow=1000&storeType=1', { method: 'GET' });
        if (data.code === 100) {
            return data.info?.data || [];
        }
        throw new Error("获取商户列表失败: " + JSON.stringify(data));
    }

    async listOffer(storeId: number): Promise<any[]> {
        // productType=1 may vary, we might need to adjust or remove it if not strictly required
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
            // 主动使缓存失效：只要机器人成功录入了一条新包，立刻清空缓存
            // 这样下一个用户点击输入框时，必定能拉取到刚刚录入的最热乎的 storeName
            this.cachedRecentStores = null;
            return data;
        }
        throw new Error("添加 Offer 失败: " + JSON.stringify(data));
    }

    private cachedRecentStores: { names: string[], expireAt: number } | null = null;

    async getRecentStoreNames(limit: number = 4): Promise<string[]> {
        // Use memory cache for 15 seconds (reduced from 60s for higher real-time accuracy)
        if (this.cachedRecentStores && Date.now() < this.cachedRecentStores.expireAt) {
            return this.cachedRecentStores.names;
        }

        // Fetch 30 rows instead of 100 to drastically reduce QL API response time
        const data = await this.qlFetch(`/api/offer/listOffer?pageNum=1&pageRow=30&productType=1`, { method: 'GET' });
        if (data.code === 100) {
            const records = data.info?.data || [];
            
            // Sort by updatedAt descending
            records.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

            // Extract unique storeNames maintaining order
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
                expireAt: Date.now() + 15000 // cache for 15 seconds
            };

            return uniqueStoreNames;
        }
        return [];
    }
}

export const qlApi = new QLApi();
